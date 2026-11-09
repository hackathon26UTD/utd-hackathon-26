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

Radio time: one persistent HTTPS connection is reused inside a burst of requests (one TLS handshake
per flush instead of one per request) and dropped after IDLE_CLOSE_S of silence, so the socket never
sits open between power-mode intervals. `rebuild_session()` drops it on demand (the watchdog's soft
self-heal). An optional guard (hbagent/watchdog.py) gates every call: a circuit breaker for outages
and a slow 15 minute retry after 401/403. Event rows carry a stable id sent as `Idempotency-Key`.
"""
from __future__ import annotations

import http.client
import json
import random
import socket
import ssl
import threading
import time
import urllib.error
import urllib.parse
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
    IDLE_CLOSE_S = 15.0

    def __init__(self, base_url: str, device_key: str, timeout: float = 10.0, opener=None, guard=None,
                 clock=time.monotonic):
        self.base = base_url.rstrip("/")
        self._key = device_key           # never logged, never printed
        self.timeout = timeout
        self._opener = opener            # injected urllib-style opener (tests); None = persistent http.client connection
        self.guard = guard               # duck-typed: allow() -> Optional[Result], record(Result)
        self._clock = clock
        self._u = urllib.parse.urlsplit(self.base)
        self._conn: Optional[http.client.HTTPConnection] = None
        self._conn_last = 0.0
        self._lock = threading.Lock()
        self._ctx = ssl.create_default_context() if self._u.scheme == "https" else None
        self.rebuilds = 0
        self.connects = 0

    # ---- connection handling
    def host(self) -> str:
        return self._u.hostname or ""

    def port(self) -> int:
        return self._u.port or (443 if self._u.scheme == "https" else 80)

    def close(self) -> None:
        with self._lock:
            self._drop()

    def rebuild_session(self) -> None:
        """Soft self-heal: drop the connection (and any stale TLS state) so the next call starts clean."""
        with self._lock:
            self._drop()
            self.rebuilds += 1

    def _drop(self) -> None:
        c, self._conn = self._conn, None
        if c is not None:
            try:
                c.close()
            except Exception:  # noqa: BLE001
                pass

    def _connect(self) -> http.client.HTTPConnection:
        self.connects += 1
        if self._u.scheme == "https":
            return http.client.HTTPSConnection(self.host(), self.port(), timeout=self.timeout, context=self._ctx)
        return http.client.HTTPConnection(self.host(), self.port(), timeout=self.timeout)

    def _exchange(self, method: str, path: str, data: Optional[bytes], headers: dict) -> tuple:
        """One request on the persistent connection. Retries once, and only when a reused connection turned out dead."""
        full = self._u.path.rstrip("/") + path
        for attempt in (0, 1):
            if self._conn is not None and self._clock() - self._conn_last > self.IDLE_CLOSE_S:
                self._drop()
            reused = self._conn is not None
            conn = self._conn or self._connect()
            self._conn = conn
            try:
                try:
                    conn.request(method, full, body=data, headers=headers)
                except (OSError, http.client.HTTPException, ValueError):
                    if reused and attempt == 0:      # send failed on a connection that sat idle: nothing was processed
                        self._drop()
                        continue
                    raise
                try:
                    r = conn.getresponse()
                except (http.client.RemoteDisconnected, ConnectionResetError, BrokenPipeError):
                    if reused and attempt == 0:      # the server closed the idle connection before answering
                        self._drop()
                        continue
                    raise
                raw = r.read(MAX_BODY + 1)
                if len(raw) > MAX_BODY or r.will_close:
                    self._drop()
                else:
                    self._conn_last = self._clock()
                return r.status, raw[:MAX_BODY]
            except BaseException:
                self._drop()
                raise
        raise OSError("unreachable")

    # ---- one call
    def _call(self, method: str, path: str, body: Optional[dict] = None, eid: Optional[str] = None) -> Result:
        data = json.dumps(body, separators=(",", ":")).encode() if body is not None else None
        if data is not None and len(data) > MAX_BODY:
            return Result(400, None, "request too large")
        if self.guard is not None:
            blocked = self.guard.allow()
            if blocked is not None:
                return blocked
        res = self._send(method, path, data, eid)
        if self.guard is not None:
            self.guard.record(res)
        return res

    def _send(self, method: str, path: str, data: Optional[bytes], eid: Optional[str]) -> Result:
        headers = {"X-Device-Key": self._key, "User-Agent": UA, "Accept": "application/json"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        if eid:
            headers["Idempotency-Key"] = eid[:80]
        if self._opener is not None:
            return self._send_urllib(method, path, data, headers)
        try:
            with self._lock:
                status, raw = self._exchange(method, path, data, headers)
        except (http.client.HTTPException, OSError, ValueError) as e:     # includes timeouts, TLS and DNS failures
            return Result(0, None, type(e).__name__)
        if 300 <= status < 400:
            return Result(0, None, "unexpected redirect")       # never treat as a rejected payload: keep the queue
        parsed = self._json(raw)
        if 200 <= status < 300:
            return Result(status, parsed)
        return Result(status, parsed, (parsed or {}).get("error", "") if isinstance(parsed, dict) else "")

    def _send_urllib(self, method: str, path: str, data: Optional[bytes], headers: dict) -> Result:
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with self._opener.open(req, timeout=self.timeout) as r:
                return Result(r.status, self._json(r.read(MAX_BODY)))
        except urllib.error.HTTPError as e:
            try:
                parsed = self._json(e.read(MAX_BODY))
            except Exception:  # noqa: BLE001
                parsed = None
            return Result(e.code, parsed, (parsed or {}).get("error", "") if isinstance(parsed, dict) else "")
        except (urllib.error.URLError, TimeoutError, OSError, socket.timeout) as e:
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

    def ingest(self, readings: list, eid: Optional[str] = None) -> Result:
        return self._call("POST", "/api/ingest", {"readings": readings}, eid)

    def event(self, etype: str, data: Optional[dict] = None, eid: Optional[str] = None) -> Result:
        return self._call("POST", "/api/events", {"type": etype, "data": data or {}}, eid)

    def messages(self, after: int = 0, limit: int = 3) -> Result:
        return self._call("GET", f"/api/device/messages?after={int(after)}&limit={int(limit)}")

    def report_message(self, message_id: str, state: str) -> Result:
        return self._call("POST", "/api/device/messages", {"message_id": message_id, "state": state})

    def settings(self) -> Result:
        return self._call("GET", "/api/device/settings")

    def report_settings(self, revision: int, poll_after_seconds: int) -> Result:
        return self._call("POST", "/api/device/settings", {"revision": revision, "pollAfterSeconds": poll_after_seconds})
