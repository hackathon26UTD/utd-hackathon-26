"""Local interfaces: a read-only status HTTP endpoint on 127.0.0.1 and an owner-only control socket.

The HTTP server never binds anything but loopback, answers GET only, checks the Host header (so a
web page in a browser cannot read it through DNS rebinding) and never includes a key or secret.
The control socket is for `agent say` / `agent cmd` on the bench; it is a unix socket with mode 600
inside the state directory and uses the same allowlist parser as operator commands.
"""
from __future__ import annotations

import json
import os
import socket
import socketserver
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable, Optional

ALLOWED_HOSTS = ("127.0.0.1", "localhost", "[::1]")


def _handler(get_status: Callable[[], dict], get_readings: Callable[[], list]):
    class H(BaseHTTPRequestHandler):
        server_version = "hbagent"
        protocol_version = "HTTP/1.0"

        def _send(self, code: int, body: bytes, ctype: str = "application/json") -> None:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):  # noqa: N802
            host = (self.headers.get("Host") or "").rsplit(":", 1)[0] if not (self.headers.get("Host") or "").startswith("[") else "[::1]"
            if host not in ALLOWED_HOSTS:
                return self._send(403, b'{"error":"loopback only"}')
            path = self.path.split("?", 1)[0]
            if path == "/healthz":
                return self._send(200, b'{"ok":true}')
            if path == "/status":
                return self._send(200, json.dumps(get_status(), default=str).encode())
            if path == "/readings":
                return self._send(200, json.dumps(get_readings(), default=str).encode())
            self._send(404, b'{"error":"not found"}')

        def _no(self):
            self._send(405, b'{"error":"read-only"}')

        do_POST = do_PUT = do_DELETE = do_PATCH = _no

        def log_message(self, *a):  # keep the journal quiet
            pass

    return H


class StatusServer:
    def __init__(self, port: int, get_status, get_readings):
        self.httpd = ThreadingHTTPServer(("127.0.0.1", port), _handler(get_status, get_readings))
        self.httpd.daemon_threads = True
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, kwargs={"poll_interval": 1.0}, name="status", daemon=True)

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()


class ControlServer:
    def __init__(self, path: str, handler: Callable[[str, str], str]):
        self.path = path
        if os.path.exists(path):
            os.unlink(path)
        old = os.umask(0o077)
        try:
            class H(socketserver.StreamRequestHandler):
                def handle(self):
                    self.request.settimeout(3)
                    try:
                        line = self.rfile.readline(600)
                        req = json.loads(line.decode("utf-8", "replace"))
                        out = handler(str(req.get("op", "")), str(req.get("text", "")))
                    except Exception as e:  # noqa: BLE001
                        out = f"refused: {type(e).__name__}"
                    self.wfile.write((json.dumps({"reply": out}) + "\n").encode())

            self.srv = socketserver.ThreadingUnixStreamServer(path, H)
            self.srv.daemon_threads = True
        finally:
            os.umask(old)
        os.chmod(path, 0o600)
        self.thread = threading.Thread(target=self.srv.serve_forever, kwargs={"poll_interval": 1.0}, name="control", daemon=True)

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self.srv.shutdown()
        self.srv.server_close()
        try:
            os.unlink(self.path)
        except OSError:
            pass


def send_control(path: str, op: str, text: str, timeout: float = 3.0) -> Optional[str]:
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.settimeout(timeout)
            s.connect(path)
            s.sendall((json.dumps({"op": op, "text": text}) + "\n").encode())
            data = s.makefile().readline()
        return json.loads(data).get("reply")
    except (OSError, ValueError):
        return None
