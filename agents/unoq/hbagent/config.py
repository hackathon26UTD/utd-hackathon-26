"""Config loading. TOML (stdlib tomllib, Python 3.11+). The device key never lives in this file.

Key sources, in order: the environment variable named by api.key_env (default HB_DEVICE_KEY),
then the file named by api.key_file (must be mode 600 or tighter and owned by the agent user).
"""
from __future__ import annotations

import os
import re
import stat
import tomllib
from dataclasses import dataclass, field
from typing import Optional

from . import power

DEFAULT_BASE = "https://utd-hackathon-26.pages.dev"
LOCAL_HOSTS = ("127.0.0.1", "localhost", "[::1]")


class ConfigError(ValueError):
    pass


@dataclass
class Config:
    base_url: str = DEFAULT_BASE
    device_id: str = ""
    key_env: str = "HB_DEVICE_KEY"
    key_file: str = ""
    state_dir: str = "/var/lib/homebeacon-unoq"
    log_file: str = ""
    # mcu
    mcu_source: str = "serial"            # serial | bridge | fake | none
    mcu_port: str = ""                    # empty = first /dev/ttyACM* or /dev/ttyUSB*
    mcu_baud: int = 115200
    mcu_identify_line: str = ""           # literal line written to the MCU for identify, e.g. "beep"; empty = never write
    # status endpoint
    status_port: int = 8765               # 127.0.0.1 only; 0 = off
    # uplink
    relay_mains: bool = True
    relay_water_from: str = ""            # box id whose water reading is gap-filled under this device; empty = off
    queue_rows: int = 2000
    queue_bytes: int = 2_000_000
    http_timeout_s: float = 10.0
    max_requests_per_flush: int = 6
    # commands
    allow_commands: bool = True
    allow_reboot_agent: bool = False
    # power
    battery_mah: float = 0.0
    battery_nominal_v: float = 0.0
    battery_chemistry: str = "unknown"
    battery_converter: str = "buck"
    assumed_soc_pct: Optional[float] = None
    power_source: str = "manual"          # manual | file | sysfs
    battery_file: str = "/run/homebeacon/battery.json"
    need_hours: float = 24.0
    last_gasp_hours: float = 2.0
    load_basis: str = "assumption"
    measured_mw: dict = field(default_factory=dict)
    assume_mains: str = "unknown"         # used only when no box reports mains: present | lost | unknown
    # update
    update_base: str = ""

    def validate(self) -> "Config":
        u = self.base_url.rstrip("/")
        host = re.sub(r"^https?://", "", u).split("/")[0].rsplit(":", 1)[0] if "://" in u else ""
        if u.startswith("https://"):
            pass
        elif u.startswith("http://") and (host in LOCAL_HOSTS or host.strip("[]") == "::1"):
            pass
        else:
            raise ConfigError("api.base_url must be https:// (http:// is allowed only for 127.0.0.1 or localhost development).")
        self.base_url = u
        if self.device_id and not re.fullmatch(r"[a-fA-F0-9]{24}", self.device_id):
            raise ConfigError("api.device_id must be the 24-character id returned at registration, not a board serial.")
        if self.mcu_source not in ("serial", "bridge", "fake", "none"):
            raise ConfigError("mcu.source must be serial, bridge, fake or none.")
        if not 0 <= self.status_port <= 65535:
            raise ConfigError("status.port must be 0 to 65535.")
        if self.assume_mains not in ("present", "lost", "unknown"):
            raise ConfigError("power.assume_mains must be present, lost or unknown.")
        if self.battery_chemistry not in power.CHEMISTRY_DERATE:
            raise ConfigError(f"power.chemistry must be one of {', '.join(power.CHEMISTRY_DERATE)}.")
        if self.battery_converter not in ("buck", "ldo", "boost"):
            raise ConfigError("power.converter must be buck, ldo or boost.")
        problem = power.converter_problem(self.battery_converter, self.battery_nominal_v)
        if problem:
            raise ConfigError(f"power.converter: {problem}")
        if self.load_basis not in ("assumption", "bench_measurement"):
            raise ConfigError("power.load_basis must be assumption or bench_measurement.")
        if self.load_basis == "bench_measurement" and not set(power.MODES) <= set(self.measured_mw):
            raise ConfigError("power.load_basis = bench_measurement needs power.measured_mw for all four modes "
                              "(full, eco, survival, beacon). Measure them all, or leave load_basis = \"assumption\".")
        if self.power_source not in ("manual", "file", "sysfs"):
            raise ConfigError("power.source must be manual, file or sysfs.")
        if not 1 <= self.need_hours <= 168:
            raise ConfigError("power.need_hours must be 1 to 168.")
        if not 0 <= self.last_gasp_hours <= 24:
            raise ConfigError("power.last_gasp_hours must be 0 to 24.")
        if self.mcu_identify_line and (len(self.mcu_identify_line) > 24 or not re.fullmatch(r"[A-Za-z0-9 _.-]+", self.mcu_identify_line)):
            raise ConfigError("mcu.identify_line must be a short plain word such as 'beep'.")
        return self

    def device_key(self) -> str:
        key = os.environ.get(self.key_env, "").strip()
        if key:
            return key
        if self.key_file:
            st = os.stat(self.key_file)
            if st.st_mode & (stat.S_IRWXG | stat.S_IRWXO):
                raise ConfigError(f"{self.key_file} must not be readable by group or others (chmod 600).")
            with open(self.key_file, encoding="utf-8") as f:
                return f.read().strip()
        return ""

    def power_config(self) -> power.PowerConfig:
        cfg = power.PowerConfig(need_hours=self.need_hours, last_gasp_hours=self.last_gasp_hours, load_basis="assumption")
        if self.measured_mw:
            cfg = cfg.with_measured(self.measured_mw)    # bench_measurement only when all four modes are measured
        return cfg

    def battery(self, soc_pct: Optional[float] = None, soc_source: str = "assumed", used_wh: float = 0.0) -> Optional[power.Battery]:
        """Battery model. With no gauge or voltage reading the charge is the entered (or assumed 100 percent)
        starting charge minus the energy the agent has counted since, labelled `integrated_estimate`."""
        if self.battery_mah <= 0 or self.battery_nominal_v <= 0:
            return None
        eff = power.converter_efficiency(self.battery_converter, self.battery_nominal_v)
        if soc_pct is None:
            start = 100.0 if self.assumed_soc_pct is None else float(self.assumed_soc_pct)
            full = power.Battery(self.battery_mah, self.battery_nominal_v, 100.0, "assumed", self.battery_chemistry, eff).usable_wh()
            used_pct = (max(0.0, used_wh) / full * 100.0) if full > 0 else 0.0
            soc_pct, soc_source = max(0.0, start - used_pct), "integrated_estimate"
        return power.Battery(self.battery_mah, self.battery_nominal_v, soc_pct, soc_source, self.battery_chemistry, eff)


def load(path: Optional[str]) -> Config:
    cfg = Config()
    if path:
        try:
            with open(path, "rb") as f:
                raw = tomllib.load(f)
        except FileNotFoundError:
            raise ConfigError(f"Config file not found: {path}")
        except tomllib.TOMLDecodeError as e:
            raise ConfigError(f"Config file is not valid TOML: {e}")
        _apply(cfg, raw)
    return cfg.validate()


_MAP = {
    "api": {"base_url": "base_url", "device_id": "device_id", "key_env": "key_env", "key_file": "key_file"},
    "agent": {"state_dir": "state_dir", "log_file": "log_file"},
    "mcu": {"source": "mcu_source", "port": "mcu_port", "baud": "mcu_baud", "identify_line": "mcu_identify_line"},
    "status": {"port": "status_port"},
    "uplink": {"relay_mains": "relay_mains", "relay_water_from": "relay_water_from", "queue_rows": "queue_rows",
               "queue_bytes": "queue_bytes", "http_timeout_s": "http_timeout_s", "max_requests_per_flush": "max_requests_per_flush"},
    "commands": {"allow": "allow_commands", "allow_reboot_agent": "allow_reboot_agent"},
    "power": {"battery_mah": "battery_mah", "nominal_v": "battery_nominal_v", "chemistry": "battery_chemistry",
              "converter": "battery_converter", "assumed_soc_pct": "assumed_soc_pct", "source": "power_source",
              "battery_file": "battery_file", "need_hours": "need_hours", "last_gasp_hours": "last_gasp_hours",
              "load_basis": "load_basis", "assume_mains": "assume_mains"},
    "update": {"base_url": "update_base"},
}


def _apply(cfg: Config, raw: dict) -> None:
    for section, table in raw.items():
        if section == "power" and isinstance(table, dict) and "measured_mw" in table:
            m = table["measured_mw"]
            if not isinstance(m, dict) or not all(k in power.MODES and isinstance(v, (int, float)) and v > 0 for k, v in m.items()):
                raise ConfigError("power.measured_mw must map full/eco/survival/beacon to milliwatts.")
            cfg.measured_mw = dict(m)
        if section not in _MAP:
            raise ConfigError(f"Unknown config section [{section}].")
        if not isinstance(table, dict):
            raise ConfigError(f"[{section}] must be a table.")
        for key, value in table.items():
            if section == "power" and key == "measured_mw":
                continue
            if key not in _MAP[section]:
                raise ConfigError(f"Unknown config key {section}.{key}.")
            attr = _MAP[section][key]
            cur = getattr(cfg, attr)
            if isinstance(cur, bool) != isinstance(value, bool) and cur is not None:
                raise ConfigError(f"{section}.{key} has the wrong type.")
            if isinstance(cur, (int, float)) and not isinstance(cur, bool) and not isinstance(value, (int, float)):
                raise ConfigError(f"{section}.{key} must be a number.")
            if isinstance(cur, str) and not isinstance(value, str):
                raise ConfigError(f"{section}.{key} must be text.")
            setattr(cfg, attr, value)


EXAMPLE = '''# HomeBeacon Uno Q agent. The device key is NOT stored here: put HB_DEVICE_KEY=... in
# /etc/homebeacon/unoq.env (mode 600) or point api.key_file at a mode 600 file.
[api]
base_url = "https://utd-hackathon-26.pages.dev"
device_id = ""                  # 24-character id from device registration

[agent]
state_dir = "/var/lib/homebeacon-unoq"

[mcu]
source = "serial"               # serial | bridge | fake | none
port = ""                       # empty = first /dev/ttyACM* or /dev/ttyUSB*
identify_line = ""              # e.g. "beep" (box A has a beep test command); empty = never write to the MCU

[status]
port = 8765                     # read-only, 127.0.0.1 only; 0 = off

[uplink]
relay_mains = true
relay_water_from = ""           # e.g. "A" to gap-fill box A's water flag under this device; empty = off

[commands]
allow = true
allow_reboot_agent = false

[power]
battery_mah = 0                 # nameplate capacity of the pack feeding the Uno Q; 0 = unknown
nominal_v = 0                   # pack nominal volts at the converter input
chemistry = "unknown"           # alkaline_aa | nimh_aa | liion | lifepo4 | lead_acid | unknown
converter = "buck"              # buck | ldo | boost. buck and ldo need a pack of 5.5 V or more (2S Li-ion); a single 3.7 V cell needs boost
assumed_soc_pct = 100           # used only when no gauge is available (low confidence)
source = "manual"               # manual | file | sysfs
need_hours = 24                 # outage length to plan for
last_gasp_hours = 2             # heartbeat the pack must still be able to run at the end
load_basis = "assumption"       # set to bench_measurement only after a USB meter run of ALL four modes
assume_mains = "unknown"
# [power.measured_mw]           # fill from a USB meter. All four modes give bench_measurement; fewer give partial_measurement
# full = 0
# eco = 0
# survival = 0
# beacon = 0
'''
