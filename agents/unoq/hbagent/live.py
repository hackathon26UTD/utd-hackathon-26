"""Terminal live view. Polls the local status endpoint every few seconds (cheap) and redraws."""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request

LABELS = {"water": "water", "mains": "wall power", "motion": "motion", "flame": "flame", "battery_mv": "battery mV",
          "tilt": "tilt", "temp_c": "temp C", "smoke_alarm": "smoke alarm", "sound_hits": "sound hits"}


def _val(v) -> str:
    if v is True:
        return "YES"
    if v is False:
        return "no"
    return str(v)


def render(st: dict, width: int = 78) -> str:
    out = []
    p = st.get("power")
    haz = st.get("hazard", {})
    out.append(f"HomeBeacon Uno Q agent {st.get('version')}  up {st.get('uptime_s', 0)}s  device {st.get('device_id') or 'not set'}")
    out.append("-" * width)
    if st.get("identify"):
        out.append("*** IDENTIFY: this is the hub you asked about ***")
    out.append("HAZARD: " + (", ".join(haz.get("reasons", [])) if haz.get("active") else "none reported (this is not a safety guarantee)"))
    mcu = st.get("mcu", {})
    out.append(f"Box link: {mcu.get('source')} {'connected' if mcu.get('connected') else 'NOT connected ' + (mcu.get('error') or '')}   wall power: {st.get('mains')}")
    if p:
        h = p.get("hours_remaining")
        out.append(f"Power: {p['mode'].upper()} (cloud sees {p['server_mode']}); reports every {p['report_s']}s, checks messages every {p['poll_s']}s; about {p['avg_mw_estimate']:.0f} mW estimated")
        out.append(f"Runway: {'unknown' if h is None else str(h) + ' h'} (confidence {p['confidence']}, target {p['target_hours']:g} h, loads {p['load_basis']})")
        for r in p.get("reasons", [])[:3]:
            out.append("  - " + r)
    u = st.get("uplink", {})
    q = u.get("queue", {})
    last = u.get("last_ok_age_s")
    out.append(f"Uplink: last success {'never' if last is None else str(int(last)) + 's ago'}; queued {q.get('rows', 0)} (critical {q.get('critical', 0)}); sent {u.get('sent', 0)}, retries {u.get('retries', 0)}")
    if u.get("last_error"):
        out.append("  ! " + u["last_error"])
    out.append("")
    boxes = st.get("live", {}).get("boxes", {})
    if not boxes:
        out.append("Boxes: no data yet (unknown, not safe)")
    for name, b in boxes.items():
        out.append(f"Box {name}: {b['state']}, last heard {int(b['age_s'])}s ago")
        vals = [f"{LABELS.get(k, k)}={_val(v['value'])}" + ("" if v["age_s"] < 120 else f" ({int(v['age_s'])}s old)") for k, v in b["values"].items()]
        for i in range(0, len(vals), 4):
            out.append("   " + "   ".join(vals[i:i + 4]))
    g = st.get("gauges") or {}
    if g:
        out.append("Hub: " + "  ".join(f"{k}={v}" for k, v in g.items() if k != "t"))
    inbox = st.get("live", {}).get("inbox", [])
    if inbox:
        out.append("")
        out.append("Messages:")
        for m in inbox[-4:]:
            out.append(f"  {time.strftime('%H:%M:%S', time.localtime(m['at']))} {m['text']}" + ("  [needs ack]" if m.get("requires_ack") else ""))
    return "\n".join(out)


def fetch(url: str, timeout: float = 3.0) -> dict:
    with urllib.request.urlopen(url.rstrip("/") + "/status", timeout=timeout) as r:
        return json.loads(r.read(1_000_000))


def run(url: str, interval: float = 2.0, once: bool = False, out=sys.stdout) -> int:
    tty = out.isatty()
    while True:
        try:
            text = render(fetch(url))
            code = 0
        except (urllib.error.URLError, OSError, ValueError):
            text, code = f"The agent is not answering at {url}. Start it with: homebeacon-unoq run", 1
        if tty and not once:
            out.write("\x1b[2J\x1b[H")
        out.write(text + "\n")
        out.flush()
        if once:
            return code
        try:
            time.sleep(max(1.0, interval))
        except KeyboardInterrupt:
            return 0
