"""HTTPS client for the HomeBeacon API. Uses only the box's X-Device-Key. Standard library only.

Endpoints (docs/API.md, clients/esp32/HOMEBEACON.md):
  POST /api/beacon/ingest   one telemetry event with an idempotent event_id
  POST /api/ingest          readings batch (max 500; we send at most 50)
  POST /api/events          discrete agent events
  GET  /api/device/messages information boxes (after=cursor, limit<=3)
  POST /api/device/messages {message_id, state: shown|acked}
  GET/POST /api/device/settings desired poll interval and applied-revision report

Result codes are mapped to what the agent should do next, following the pseudocode in
clients/esp32/HOMEBEACON.md: 202 remove from queue; 5xx/network retry later with backoff;
409 conflict or no home: do not hammer; 400 quarantine; 401/403 stop and re-provision.
"""
from __future__ import annotations

import json
import random
import ssl
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Optional

MAX_BODY = 262_144
UA = "homebeacon-unoq-agent"


@dataclass
class Result:
    status: int            # 0 = network failure
    body: Optional[dict]
    error: str = ""

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300

    @property
    def retry(self) -> bool:
        return self.status == 0 or self.status >= 500 or self.status == 429

    @property
    def auth(self) -> bool:
        return self.status in (401, 403)


class Backoff:
    """Exponential backoff with jitter. Never below the Wi-Fi retry floor the power mode asks for."""

    def __init__(self, base: float = 5.0, cap: float = 900.0, rng: Optional[random.Random] = None):
        self.base, self.cap, self.n = base, cap, 0
        self.rng = rng or random.Random()

    def failure(self, floor: float = 0.0) -> float:
        self.n = min(self.n + 1, 16)
        raw = min(self.cap, self.base * (2 ** (self.n - 1)))
        return max(floor, raw * self.rng.uniform(0.5, 1.5))

    def success(self) -> None:
        self.n = 0


class Api:
    def __init__(self, base_url: str, device_key: str, timeout: float = 10.0, opener=None):
        self.base = base_url.rstrip("/")
        self._key = device_key           # never logged, never printed
        self.timeout = timeout
        self._opener = opener or urllib.request.build_opener(urllib.request.HTTPSHandler(context=ssl.create_default_context()))

    def _call(self, method: str, path: str, body: Optional[dict] = None) -> Result:
        data = json.dumps(body, separators=(",", ":")).encode() if body is not None else None
        if data is not None and len(data) > MAX_BODY:
            return Result(400, None, "request too large")
        req = urllib.request.Request(self.base + path, data=data, method=method)
        req.add_header("X-Device-Key", self._key)
        req.add_header("User-Agent", UA)
        req.add_header("Accept", "application/json")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with self._opener.open(req, timeout=self.timeout) as r:
                return Result(r.status, self._json(r.read(MAX_BODY)))
        except urllib.error.HTTPError as e:
            try:
                parsed = self._json(e.read(MAX_BODY))
            except Exception:
                parsed = None
            return Result(e.code, parsed, (parsed or {}).get("error", "") if isinstance(parsed, dict) else "")
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            return Result(0, None, type(e).__name__)

    @staticmethod
    def _json(raw: bytes) -> Optional[dict]:
        try:
            v = json.loads(raw.decode("utf-8", "replace") or "null")
            return v if isinstance(v, dict) else {"value": v}
        except json.JSONDecodeError:
            return None

    def beacon_ingest(self, body: dict) -> Result:
        return self._call("POST", "/api/beacon/ingest", body)

    def ingest(self, readings: list) -> Result:
        return self._call("POST", "/api/ingest", {"readings": readings})

    def event(self, etype: str, data: Optional[dict] = None) -> Result:
        return self._call("POST", "/api/events", {"type": etype, "data": data or {}})

    def messages(self, after: int = 0, limit: int = 3) -> Result:
        return self._call("GET", f"/api/device/messages?after={int(after)}&limit={int(limit)}")

    def report_message(self, message_id: str, state: str) -> Result:
        return self._call("POST", "/api/device/messages", {"message_id": message_id, "state": state})

    def settings(self) -> Result:
        return self._call("GET", "/api/device/settings")

    def report_settings(self, revision: int, poll_after_seconds: int) -> Result:
        return self._call("POST", "/api/device/settings", {"revision": revision, "pollAfterSeconds": poll_after_seconds})
