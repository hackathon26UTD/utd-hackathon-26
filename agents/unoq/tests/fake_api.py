"""A tiny in-process stand-in for the HomeBeacon device API. Records every request."""
from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

KEY = "dk_test_only_not_a_secret"


class FakeApi:
    def __init__(self):
        self.requests: list[dict] = []
        self.fail_with: int | None = None          # force this status on every request
        self.beacon_409: str | None = None         # answer beacon posts with 409 and this error text
        self.messages: list[dict] = []
        self.config: dict | None = None            # {"revision":..,"pollAfterSeconds":..}
        self.seen_event_ids: set[str] = set()
        self.acks: list[tuple] = []
        self.lock = threading.Lock()
        api = self

        class H(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.0"

            def log_message(self, *a):
                pass

            def _reply(self, code, obj):
                body = json.dumps(obj).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def _body(self):
                n = int(self.headers.get("Content-Length") or 0)
                return json.loads(self.rfile.read(n) or b"null") if n else None

            def _handle(self, method):
                body = self._body() if method == "POST" else None
                path = self.path.split("?")[0]
                with api.lock:
                    api.requests.append({"method": method, "path": self.path, "body": body, "key": self.headers.get("X-Device-Key")})
                if self.headers.get("X-Device-Key") != KEY:
                    return self._reply(401, {"error": "Invalid device key"})
                if api.fail_with:
                    return self._reply(api.fail_with, {"error": "forced"})
                if method == "POST" and path == "/api/beacon/ingest":
                    if api.beacon_409:
                        return self._reply(409, {"error": api.beacon_409})
                    dup = body["event_id"] in api.seen_event_ids
                    api.seen_event_ids.add(body["event_id"])
                    return self._reply(202, {"accepted": True, "duplicate": dup})
                if method == "POST" and path == "/api/ingest":
                    return self._reply(202, {"accepted": len(body["readings"]), "messages_pending": 0, "poll_after_s": 30})
                if method == "POST" and path == "/api/events":
                    return self._reply(201, {"event": {}})
                if method == "GET" and path == "/api/device/messages":
                    after = int(self.path.split("after=")[1].split("&")[0])
                    out = [m for m in api.messages if m["seq"] > after][:3]
                    res = {"messages": out, "cursor": out[-1]["seq"] if out else after, "poll_after_s": 30}
                    if api.config:
                        res["configuration"] = api.config
                    return self._reply(200, res)
                if method == "POST" and path == "/api/device/messages":
                    api.acks.append((body["message_id"], body["state"]))
                    return self._reply(200, {"state": body["state"]})
                if method == "POST" and path == "/api/device/settings":
                    if not api.config or body["revision"] != api.config["revision"]:
                        return self._reply(409, {"error": "stale"})
                    return self._reply(200, {"configuration": api.config})
                if method == "GET" and path == "/api/device/settings":
                    return self._reply(200, {"configuration": api.config})
                return self._reply(404, {"error": "nope"})

            def do_GET(self):  # noqa: N802
                self._handle("GET")

            def do_POST(self):  # noqa: N802
                self._handle("POST")

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.httpd.daemon_threads = True
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        self.thread = threading.Thread(target=self.httpd.serve_forever, kwargs={"poll_interval": 0.1}, daemon=True)

    def start(self):
        self.thread.start()
        return self

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()

    def paths(self, method=None):
        return [r["path"].split("?")[0] for r in self.requests if method in (None, r["method"])]
