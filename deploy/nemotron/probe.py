#!/usr/bin/env python3
"""Verify authentication and one synthetic tool call without printing secrets/data."""
import json
from pathlib import Path
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

MODEL = 'nvidia/NVIDIA-Nemotron-Nano-9B-v2'
base = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8000/v1').rstrip('/')
url = urllib.parse.urlsplit(base)
if (url.scheme != 'https' and not (url.scheme == 'http' and url.hostname in ('127.0.0.1', 'localhost', '::1'))) or url.username or url.password or url.query or url.fragment:
    raise SystemExit('Use HTTPS, or HTTP on localhost only, with no URL credentials/query/fragment.')
values = dict(line.split('=', 1) for line in Path(__file__).with_name('.env.inference').read_text().splitlines() if '=' in line)
key = values.get('VLLM_API_KEY', '')
if not key:
    raise SystemExit('Missing VLLM_API_KEY in private .env.inference.')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


opener = urllib.request.build_opener(NoRedirect)
try:
    try:
        with opener.open(base + '/models', timeout=10):
            raise SystemExit('Failed: endpoint accepted an unauthenticated model-list request.')
    except urllib.error.HTTPError as error:
        if error.code not in (401, 403):
            raise SystemExit(f'Endpoint not ready: unauthenticated check returned HTTP {error.code}.')
    payload = {
        'model': MODEL,
        'messages': [
            {'role': 'system', 'content': '/no_think\nCall record_probe with status connected. Do not answer in plain text.'},
            {'role': 'user', 'content': 'This is a synthetic HomeBeacon integration check.'},
        ],
        'tools': [{'type': 'function', 'function': {
            'name': 'record_probe', 'description': 'Record a synthetic integration probe.',
            'parameters': {'type': 'object', 'properties': {'status': {'type': 'string', 'enum': ['connected']}}, 'required': ['status'], 'additionalProperties': False},
        }}],
        'tool_choice': 'auto', 'temperature': 0, 'max_tokens': 256, 'stream': False,
    }
    request = urllib.request.Request(base + '/chat/completions', data=json.dumps(payload).encode(), headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'}, method='POST')
    started = time.monotonic()
    with opener.open(request, timeout=20) as response:
        raw = response.read(100001)
        if len(raw) > 100000:
            raise SystemExit('Failed: model response exceeded the probe size limit.')
        result = json.loads(raw)
    calls = result.get('choices', [{}])[0].get('message', {}).get('tool_calls', [])
    connected = any(call.get('function', {}).get('name') == 'record_probe' and json.loads(call['function'].get('arguments', '{}')) == {'status': 'connected'} for call in calls)
    if not connected:
        raise SystemExit('Failed: model did not return the expected structured tool call.')
    print(json.dumps({'status': 'connected', 'model': MODEL, 'authentication': 'enforced', 'seconds': round(time.monotonic() - started, 2)}))
except urllib.error.HTTPError as error:
    raise SystemExit(f'Probe failed with HTTP {error.code}; response body suppressed.') from None
except (urllib.error.URLError, TimeoutError, OSError):
    raise SystemExit('Probe could not reach the endpoint within its time limit.') from None
except (ValueError, TypeError, KeyError, IndexError):
    raise SystemExit('Probe failed: unexpected model response format; body suppressed.') from None
