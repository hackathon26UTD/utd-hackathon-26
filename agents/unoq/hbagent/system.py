"""Reads of the hub's own gauges and battery. Every read is optional and returns None when absent.

Nothing here writes to the system. Applying a CPU governor or Wi-Fi power save needs root, so the
agent only reports the recommended settings (see docs/POWER_DESIGN.md and packaging/apply-power-profile.sh).
"""
from __future__ import annotations

import glob
import json
import os
import time
from typing import Optional

from . import power


def _read(path: str) -> Optional[str]:
    try:
        with open(path, encoding="ascii", errors="replace") as f:
            return f.read(256).strip()
    except OSError:
        return None


def cpu_temp_c() -> Optional[float]:
    temps = []
    for p in glob.glob("/sys/class/thermal/thermal_zone*/temp"):
        v = _read(p)
        if v and v.lstrip("-").isdigit():
            temps.append(int(v) / 1000.0)
    return round(max(temps), 1) if temps else None


def sample() -> dict:
    out: dict = {}
    t = cpu_temp_c()
    if t is not None:
        out["cpu_temp_c"] = t
    try:
        out["load1"] = round(os.getloadavg()[0], 2)
    except OSError:
        pass
    mem = _read_meminfo()
    if mem:
        out["mem_avail_mb"] = mem
    up = _read("/proc/uptime")
    if up:
        try:
            out["os_uptime_s"] = int(float(up.split()[0]))
        except ValueError:
            pass
    return out


def _read_meminfo() -> Optional[int]:
    try:
        with open("/proc/meminfo", encoding="ascii", errors="replace") as f:
            for line in f:
                if line.startswith("MemAvailable:"):
                    return int(line.split()[1]) // 1024
    except (OSError, ValueError, IndexError):
        pass
    return None


class BatteryReading:
    def __init__(self, soc_pct=None, soc_source="assumed", mains=None, charging=None, note=""):
        self.soc_pct, self.soc_source, self.mains, self.charging, self.note = soc_pct, soc_source, mains, charging, note


def read_battery(source: str, cfg, now_epoch: Optional[float] = None) -> BatteryReading:
    now_epoch = now_epoch or time.time()
    if source == "sysfs":
        return _sysfs()
    if source == "file":
        return _file(cfg, now_epoch)
    return BatteryReading()


def _sysfs() -> BatteryReading:
    soc = mains = charging = None
    for d in glob.glob("/sys/class/power_supply/*"):
        kind = _read(d + "/type")
        if kind == "Battery":
            cap = _read(d + "/capacity")
            if cap and cap.isdigit():
                soc = float(cap)
            charging = (_read(d + "/status") or "").lower() == "charging"
        elif kind in ("Mains", "USB"):
            on = _read(d + "/online")
            if on in ("0", "1"):
                mains = (on == "1") or bool(mains)
    return BatteryReading(soc, "gauge" if soc is not None else "assumed", mains, charging, "sysfs power_supply")


def _file(cfg, now_epoch: float) -> BatteryReading:
    """JSON written by a fuel gauge helper: {"soc_pct":..,"voltage_v":..,"mains":bool,"charging":bool,"at":epoch}."""
    raw = _read(cfg.battery_file)
    if not raw:
        return BatteryReading(note="battery file missing")
    try:
        d = json.loads(raw)
        at = float(d.get("at", 0))
    except (ValueError, TypeError, AttributeError):
        return BatteryReading(note="battery file unreadable")
    if now_epoch - at > 300 or at > now_epoch + 60:
        return BatteryReading(note="battery file is stale, ignored")   # stale = unknown, never last value
    mains = d.get("mains") if isinstance(d.get("mains"), bool) else None
    charging = d.get("charging") if isinstance(d.get("charging"), bool) else None
    soc = d.get("soc_pct")
    if isinstance(soc, (int, float)) and not isinstance(soc, bool) and 0 <= soc <= 100:
        return BatteryReading(float(soc), "gauge", mains, charging, "battery file")
    v = d.get("voltage_v")
    cell_v = power.CHEMISTRY_CELL_V.get(cfg.battery_chemistry)
    if isinstance(v, (int, float)) and cell_v and cfg.battery_nominal_v > 0:
        cells = max(1, round(cfg.battery_nominal_v / cell_v))
        est = power.soc_from_voltage(cfg.battery_chemistry, float(v) / cells)
        if est is not None:
            return BatteryReading(est, "voltage_estimate", mains, charging, "voltage guess")
    return BatteryReading(None, "assumed", mains, charging, "battery file has no usable charge")


GOVERNOR = {"full": "ondemand", "eco": "powersave", "survival": "powersave", "beacon": "powersave"}


def recommended_os_settings(mode: str) -> dict:
    """What an operator may apply as root. The unprivileged agent never changes these itself."""
    return {"cpu_governor": GOVERNOR.get(mode, "powersave"), "wifi_power_save": mode != "full",
            "bluetooth": "off", "note": "run packaging/apply-power-profile.sh <mode> as root; not applied by the agent"}
