"""MCU line protocol, live state, hazard rules and API payload builders.

Box A prints `HB {json}` lines (firmware/box_a/box_a.ino observe()). The parser accepts the same
shape as firmware/hub/hub.py and nothing else; debug output is ignored.

Safety semantics kept here:
  - Missing data is unknown. A value older than FRESH_S is shown with its age and flagged stale.
  - A hazard seen earlier does not turn safe because time passed. It clears only when a newer
    reading from the same box shows the field false, and it is held at least HAZARD_HOLD_S.
  - Nothing here infers occupancy, safe entry, damage or dispatch.
"""
from __future__ import annotations

import json
import re
import threading
from collections import deque
from dataclasses import dataclass
from typing import Optional

FRESH_S = 120            # same as FRESH_MS in domain/system-policy.js
HAZARD_HOLD_S = 600
BOX_RE = re.compile(r"[A-Z0-9]{1,5}")
HAZARD_EVENT_PREFIXES = ("flame", "water", "smoke", "fire", "alarm.beeping", "quake")
SOUND_HITS_ALARM = 6      # domain/system-policy.js
TEMP_CRITICAL_C = 55      # domain/system-policy.js
MAX_LINE = 2048

BOOL_FIELDS = ("water", "mains", "motion", "flame", "tilt", "smoke_alarm")


def parse_hb_line(line: str) -> Optional[dict]:
    """Return the decoded message for an `HB {json}` line, else None."""
    line = line.strip()
    if len(line) > MAX_LINE or not line.startswith("HB "):
        return None
    try:
        msg = json.loads(line[3:])
    except json.JSONDecodeError:
        return None
    if not isinstance(msg, dict) or not BOX_RE.fullmatch(str(msg.get("box", ""))):
        return None
    return msg


def hazards_in(msg: dict) -> list[str]:
    """Names of hazards a single message reports. Explicit true values only."""
    out = []
    for key in ("water", "flame", "smoke_alarm"):
        if msg.get(key) is True:
            out.append(key)
    hits = msg.get("sound_hits")
    if isinstance(hits, (int, float)) and hits >= SOUND_HITS_ALARM:
        out.append("sound_alarm")
    t = msg.get("temp_c")
    if isinstance(t, (int, float)) and not isinstance(t, bool) and t >= TEMP_CRITICAL_C:
        out.append("high_temp")
    ev = msg.get("event")
    if msg.get("type") == "event" and isinstance(ev, str) and ev.startswith(HAZARD_EVENT_PREFIXES):
        out.append(f"event:{ev[:24]}")
    return out


class LiveState:
    """Thread-safe latest values per box, a ring of recent messages and the hazard latch."""

    def __init__(self, ring_size: int = 300, inbox_size: int = 20):
        self._lock = threading.Lock()
        self.boxes: dict[str, dict] = {}
        self.ring: deque = deque(maxlen=ring_size)
        self.inbox: deque = deque(maxlen=inbox_size)
        self.hazard_since: Optional[float] = None
        self.hazard_reasons: dict[str, float] = {}   # reason -> last seen (monotonic)
        self.clear_seen: dict[str, float] = {}
        self.counters = {"lines": 0, "ignored": 0, "events": 0}

    def ingest(self, msg: dict, now: float) -> list[str]:
        """Record a message. Returns hazards reported by it (empty list = none reported)."""
        box = msg["box"]
        found = hazards_in(msg)
        with self._lock:
            self.counters["lines"] += 1
            if msg.get("type") == "event":
                self.counters["events"] += 1
            b = self.boxes.setdefault(box, {"values": {}, "seen": {}, "last": 0.0})
            b["last"] = now
            for k, v in msg.items():
                if k in ("box", "type"):
                    continue
                b["values"][k] = v
                b["seen"][k] = now
            self.ring.append({"t": now, "box": box, "type": msg.get("type"), "event": msg.get("event"),
                              "v": {k: v for k, v in msg.items() if k not in ("box", "type", "event")}})
            for h in found:
                self.hazard_reasons[f"{box}:{h}"] = now
            if found and self.hazard_since is None:
                self.hazard_since = now
            if msg.get("type") == "reading":
                # A fresh reading with an explicit false clears that field's hazard after the hold.
                for key in ("water", "flame", "smoke_alarm"):
                    if msg.get(key) is False:
                        self.clear_seen[f"{box}:{key}"] = now
                # Numeric hazards clear the same way: a fresh reading back under the threshold, same key as the reason.
                t = msg.get("temp_c")
                if isinstance(t, (int, float)) and not isinstance(t, bool) and t < TEMP_CRITICAL_C:
                    self.clear_seen[f"{box}:high_temp"] = now
                hits = msg.get("sound_hits")
                if isinstance(hits, (int, float)) and not isinstance(hits, bool) and hits < SOUND_HITS_ALARM:
                    self.clear_seen[f"{box}:sound_alarm"] = now
        return found

    def hazard(self, now: float) -> tuple[bool, list[str]]:
        """Active hazard reasons. Held at least HAZARD_HOLD_S, then cleared only by a newer false reading.

        `event:<name>` reasons have no field to turn false. They clear after the hold only when the same box
        has been heard from since, so a silent box never turns safe by the clock alone.
        """
        with self._lock:
            active = []
            for reason, seen in list(self.hazard_reasons.items()):
                cleared = self.clear_seen.get(reason, -1.0) > seen
                if not cleared and ":event:" in reason:
                    b = self.boxes.get(reason.split(":", 1)[0])
                    cleared = bool(b) and b["last"] > seen and now - b["last"] <= FRESH_S
                if cleared and now - seen >= HAZARD_HOLD_S:
                    del self.hazard_reasons[reason]
                else:
                    active.append(reason)
            if not active:
                self.hazard_since = None
            return bool(active), sorted(active)

    def fresh_any(self, now: float) -> bool:
        """True when at least one box has been heard from within FRESH_S. No box heard means hazard state is unknown."""
        with self._lock:
            return any(now - b["last"] <= FRESH_S for b in self.boxes.values())

    def mains(self, now: float) -> str:
        """present | lost | unknown from the freshest box reading. Stale means unknown."""
        with self._lock:
            best = None
            for b in self.boxes.values():
                t = b["seen"].get("mains")
                v = b["values"].get("mains")
                if t is not None and isinstance(v, bool) and (best is None or t > best[0]):
                    best = (t, v)
        if best is None or now - best[0] > FRESH_S:
            return "unknown"
        return "present" if best[1] else "lost"

    def view(self, now: float) -> dict:
        with self._lock:
            boxes = {}
            for name, b in sorted(self.boxes.items()):
                age = now - b["last"]
                boxes[name] = {
                    "age_s": round(age, 1),
                    "state": "fresh" if age <= FRESH_S else "stale (unknown, not safe)",
                    "values": {k: {"value": v, "age_s": round(now - b["seen"][k], 1)} for k, v in b["values"].items()
                               if k not in ("seq", "hops", "epoch", "gateway", "event")},
                    "last_event": b["values"].get("event"),
                }
            return {"boxes": boxes, "counters": dict(self.counters), "inbox": list(self.inbox)}

    def recent(self, n: int = 50) -> list[dict]:
        with self._lock:
            return list(self.ring)[-n:]


@dataclass
class Sequencer:
    """Event ids that are unique across reboots: <device>-<boot>-<seq>. Sequence alone is not identity."""
    device_id: str
    boot: int
    seq: int = 0

    def next(self) -> tuple[str, int]:
        self.seq += 1
        return f"{self.device_id}-{self.boot}-{self.seq}", self.seq


def iso_utc(epoch: float) -> str:
    import datetime as _dt
    return _dt.datetime.fromtimestamp(epoch, _dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def clock_plausible(epoch: float) -> bool:
    return epoch > 1_767_225_600  # 2026-01-01; a Linux board with no RTC may boot in 1970


def beacon_payload(device_id: str, event_id: str, seq: int, epoch: float, *, mains: Optional[bool] = None,
                   battery_pct: Optional[float] = None, water: Optional[bool] = None) -> Optional[dict]:
    """POST /api/beacon/ingest body. None if there is nothing to report (the API needs at least one field)."""
    body: dict = {"device_id": device_id, "event_id": event_id, "sequence": seq}
    if isinstance(mains, bool):
        body["main_power_available"] = mains
    if isinstance(water, bool):
        body["water_detected"] = water
    if isinstance(battery_pct, (int, float)) and not isinstance(battery_pct, bool) and 0 <= battery_pct <= 100:
        body["battery_pct"] = round(float(battery_pct), 1)
    if len(body) == 3:
        return None
    if clock_plausible(epoch):
        body["observed_at"] = iso_utc(epoch)   # omitted when the clock was never trusted: server marks the fallback
    return body


def reading(sensor: str, value, unit: Optional[str], epoch: float) -> dict:
    r = {"sensor": sensor, "value": value}
    if unit:
        r["unit"] = unit
    if clock_plausible(epoch):
        r["ts"] = iso_utc(epoch)
    return r
