"""A small local stand-in for the HomeBeacon API and the download site, for end-to-end tests.

Serves /api/ready, the device routes the agent uses, and /downloads/unoq/*. Modes: ok, outage (503), reject (401).
"""
import io
import json
import os
import tarfile
import threading
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SRC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def build_release(version, run_agent_override=None):
    """A real tarball of this agent source with VERSION rewritten, shaped like the packager's output."""
    top = f"homebeacon-unoq-{version}"
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        def add(name, data, mode=0o644):
            ti = tarfile.TarInfo(f"{top}/{name}")
            ti.size, ti.mode, ti.mtime = len(data), mode, 1767225600
            tf.addfile(ti, io.BytesIO(data))
        for root, dirs, files in os.walk(SRC):
            dirs[:] = sorted(d for d in dirs if d not in ("tests", "__pycache__", ".pytest_cache"))
            for f in sorted(files):
                if f in ("conftest.py", ".DS_Store") or f.endswith(".pyc"):
                    continue
                rel = os.path.relpath(os.path.join(root, f), SRC).replace(os.sep, "/")
                data = open(os.path.join(root, f), "rb").read()
                if rel == "VERSION":
                    data = (version + "\n").encode()
                if rel == "run_agent.py" and run_agent_override:
                    data = run_agent_override.encode()
                add(rel, data, 0o755 if rel == "run_agent.py" else 0o644)
    return buf.getvalue()


class MockHub:
    def __init__(self, key="dk_" + "Qx9" * 8, device_id="d" * 24):
        self.key, self.device_id = key, device_id
        self.mode = "ok"
        self.requests, self.events, self.ingests = [], [], []
        self.files, self.manifest_name = {}, "manifest.json"
        hub = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _send(self, code, obj=None, raw=None):
                body = raw if raw is not None else json.dumps(obj if obj is not None else {}).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json" if raw is None else "application/octet-stream")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def _serve(self):
                path = self.path.split("?")[0]
                n = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(n) or b"null") if n else None
                hub.requests.append((self.command, path, self.headers.get("X-Device-Key") == hub.key))
                if path.startswith("/downloads/unoq/"):
                    data = hub.files.get(path.rsplit("/", 1)[1])
                    return self._send(200, raw=data) if data is not None else self._send(404, {"error": "no"})
                if path == "/api/ready":
                    return self._send(200, {"status": "ready"})
                if hub.mode == "outage":
                    return self._send(503, {"error": "down"})
                if self.headers.get("X-Device-Key") != hub.key or hub.mode == "reject":
                    return self._send(401, {"error": "Invalid device key"})
                if path == "/api/events" and self.command == "POST":
                    hub.events.append(body)
                    return self._send(201, {"event": {}})
                if path in ("/api/ingest", "/api/beacon/ingest"):
                    hub.ingests.append(body)
                    return self._send(202, {"accepted": True, "poll_after_s": 30})
                if path == "/api/device/messages":
                    return self._send(200, {"messages": [], "cursor": 0, "poll_after_s": 30})
                if path == "/api/device/settings":
                    return self._send(200, {"configuration": None})
                return self._send(404, {"error": "not found"})

            do_GET = do_POST = _serve

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def publish(self, version, critical=False, **kw):
        tgz = build_release(version, **kw)
        name = f"homebeacon-unoq-{version}.tar.gz"
        self.files[name] = tgz
        self.files[self.manifest_name] = json.dumps({
            "name": "homebeacon-unoq", "version": version, "file": name, "size": len(tgz),
            "sha256": hashlib.sha256(tgz).hexdigest(), "channel": "stable", "critical": critical}).encode()
        return tgz

    def event_types(self):
        return [e.get("type") for e in self.events]

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()
