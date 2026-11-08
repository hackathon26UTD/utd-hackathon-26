#!/usr/bin/env python3
"""Private, authenticated, nonstreaming gateway for the temporary demo tunnel."""
import hmac
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import socket

MAX_REQUEST = 256 * 1024
MAX_RESPONSE = 1024 * 1024
TIMEOUT = 45


class GatewayHandler(BaseHTTPRequestHandler):
    server_version = 'HomeBeacon'
    sys_version = ''

    def setup(self):
        super().setup()
        self.connection.settimeout(TIMEOUT)

    def log_message(self, format, *args):
        pass  # Never log request paths, credentials, prompts, or model output.

    def __getattr__(self, name):
        if name.startswith('do_'):
            return self.handle_api
        raise AttributeError(name)

    def reply(self, status, body):
        self.close_connection = True
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Connection', 'close')
        self.end_headers()
        if self.command != 'HEAD':
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError, TimeoutError):
                pass

    def reject(self, status, message):
        self.reply(status, json.dumps({'error': message}).encode())

    def handle_api(self):
        authorization = self.headers.get_all('Authorization', [])
        if len(authorization) != 1 or not hmac.compare_digest(authorization[0].encode('latin-1'), self.server.expected_authorization):
            self.reject(401, 'Unauthorized')
            return
        if self.command not in ('GET', 'POST'):
            self.reject(405, 'Method not allowed')
            return
        if (self.command, self.path) not in (('GET', '/v1/models'), ('POST', '/v1/chat/completions')):
            self.reject(404, 'Not found')
            return
        if self.headers.get('Transfer-Encoding') is not None or self.headers.get('Content-Encoding') not in (None, 'identity'):
            self.reject(400, 'Unsupported body encoding')
            return
        lengths = self.headers.get_all('Content-Length', [])
        if len(lengths) > 1 or (lengths and not re.fullmatch(r'[0-9]{1,9}', lengths[0])):
            self.reject(400, 'Invalid Content-Length')
            return
        length = int(lengths[0]) if lengths else 0
        if length > MAX_REQUEST:
            self.reject(413, 'Request too large')
            return
        body = None
        if self.command == 'GET' and length:
            self.reject(400, 'GET requests cannot include a body')
            return
        if self.command == 'POST':
            if not length:
                self.reject(411, 'A nonempty Content-Length is required')
                return
            if self.headers.get('Content-Type', '').split(';', 1)[0].strip().lower() != 'application/json':
                self.reject(415, 'JSON is required')
                return
            try:
                body = self.rfile.read(length)
                if len(body) != length:
                    self.reject(400, 'Incomplete request body')
                    return
                payload = json.loads(body)
            except (ValueError, UnicodeError):
                self.reject(400, 'Invalid JSON')
                return
            except (TimeoutError, ConnectionResetError):
                self.reject(408, 'Request timed out')
                return
            if not isinstance(payload, dict) or payload.get('stream', False) is not False:
                self.reject(400, 'Only nonstreaming JSON requests are supported')
                return

        upstream = http.client.HTTPConnection('127.0.0.1', self.server.upstream_port, timeout=TIMEOUT)
        try:
            upstream.request(self.command, self.path, body=body, headers={
                'Authorization': self.server.expected_authorization.decode('ascii'),
                'Content-Type': 'application/json',
            })
            response = upstream.getresponse()
            if 300 <= response.status < 400:
                self.reject(502, 'Upstream redirects are not supported')
                return
            result = response.read(MAX_RESPONSE + 1)
            if len(result) > MAX_RESPONSE:
                self.reject(502, 'Upstream response too large')
                return
            self.reply(response.status, result)
        except (TimeoutError, socket.timeout):
            self.reject(504, 'Upstream timed out')
        except (OSError, http.client.HTTPException):
            self.reject(502, 'Upstream unavailable')
        finally:
            upstream.close()


class GatewayServer(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        pass  # Suppress tracebacks that could contain request context.


def make_server(key, port=8080, upstream_port=8000):
    if not re.fullmatch(r'[A-Za-z0-9_-]{32,}', key):
        raise ValueError('Inference key must contain at least 32 URL-safe characters.')
    server = GatewayServer(('127.0.0.1', port), GatewayHandler)
    server.expected_authorization = ('Bearer ' + key).encode('ascii')
    server.upstream_port = upstream_port
    return server


if __name__ == '__main__':
    secret_file = Path(__file__).with_name('.env.inference')
    values = dict(line.split('=', 1) for line in secret_file.read_text().splitlines() if '=' in line)
    server = make_server(values.get('VLLM_API_KEY', ''))
    print('HomeBeacon inference gateway listening on 127.0.0.1:8080', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
