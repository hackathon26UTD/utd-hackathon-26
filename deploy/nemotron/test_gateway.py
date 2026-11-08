import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
import unittest

from gateway import make_server, MAX_REQUEST, MAX_RESPONSE

KEY = 'synthetic_probe_key_not_a_secret_' + 'x' * 32


class MockUpstream(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', '0')))
        self.server.requests.append((self.command, self.path, self.headers.get('Authorization'), body))
        reply = self.server.response
        self.send_response(200)
        self.send_header('Content-Length', str(len(reply)))
        self.end_headers()
        self.wfile.write(reply)

    def do_GET(self):
        self.do_POST()


class GatewayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.upstream = ThreadingHTTPServer(('127.0.0.1', 0), MockUpstream)
        cls.upstream.requests = []
        cls.upstream.response = b'{"choices":[{"message":{"content":"connected"}}]}'
        cls.gateway = make_server(KEY, port=0, upstream_port=cls.upstream.server_port)
        for server in (cls.upstream, cls.gateway):
            threading.Thread(target=server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        for server in (cls.gateway, cls.upstream):
            server.shutdown()
            server.server_close()

    def setUp(self):
        self.upstream.requests.clear()
        self.upstream.response = b'{"choices":[{"message":{"content":"connected"}}]}'

    def request(self, method='POST', path='/v1/chat/completions', payload=None, auth=True, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.gateway.server_port, timeout=2)
        values = {'Content-Type': 'application/json'}
        if auth:
            values['Authorization'] = 'Bearer ' + KEY
        values.update(headers or {})
        body = json.dumps(payload or {'messages': [], 'stream': False}).encode() if method == 'POST' else None
        try:
            connection.request(method, path, body, values)
            response = connection.getresponse()
            return response.status, response.read()
        finally:
            connection.close()

    def test_unauthorized_never_reaches_upstream_or_waits_for_body(self):
        connection = http.client.HTTPConnection('127.0.0.1', self.gateway.server_port, timeout=2)
        connection.putrequest('POST', '/v1/chat/completions')
        connection.putheader('Content-Length', '100')
        connection.endheaders()  # Deliberately send no body: auth must reject first.
        self.assertEqual(connection.getresponse().status, 401)
        connection.close()
        self.assertEqual(self.upstream.requests, [])

    def test_authorized_post_forwards_only_expected_headers_and_body(self):
        payload = {'model': 'synthetic', 'messages': [], 'stream': False}
        status, result = self.request(payload=payload)
        self.assertEqual(status, 200)
        self.assertEqual(result, self.upstream.response)
        method, path, authorization, body = self.upstream.requests[0]
        self.assertEqual((method, path), ('POST', '/v1/chat/completions'))
        self.assertEqual(authorization, 'Bearer ' + KEY)
        self.assertEqual(json.loads(body), payload)

    def test_models_is_authenticated_and_forwarded(self):
        self.assertEqual(self.request('GET', '/v1/models', auth=False)[0], 401)
        self.assertEqual(self.request('GET', '/v1/models')[0], 200)
        self.assertEqual(len(self.upstream.requests), 1)

    def test_disallowed_routes_methods_and_streams_do_not_forward(self):
        for method, path in [('GET', '/metrics'), ('GET', '/v1/models?x=1'), ('POST', '/v1/models'), ('DELETE', '/v1/models'), ('UNKNOWN', '/v1/models')]:
            with self.subTest(method=method, path=path):
                self.assertIn(self.request(method, path)[0], (404, 405))
                self.assertEqual(self.request(method, path, auth=False)[0], 401)
        self.assertEqual(self.request(payload={'stream': True})[0], 400)
        self.assertEqual(self.upstream.requests, [])

    def test_size_limits(self):
        self.assertEqual(self.request(headers={'Content-Length': str(MAX_REQUEST + 1)})[0], 413)
        self.assertEqual(self.upstream.requests, [])
        self.upstream.response = b'x' * (MAX_RESPONSE + 1)
        self.assertEqual(self.request()[0], 502)


if __name__ == '__main__':
    unittest.main()
