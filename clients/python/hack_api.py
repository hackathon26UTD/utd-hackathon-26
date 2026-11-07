#!/usr/bin/env python3
"""Tiny standard-library client for the team API (Raspberry Pi, laptops, scripts).

    export API_BASE=https://utd-hackathon-26.pages.dev
    export DEVICE_KEY=dk_...          # for sending readings/events
    export API_ADMIN_KEY=ak_...       # for admin calls
    python3 hack_api.py demo          # sends synthetic readings every 2 s
    python3 hack_api.py register "Pi camera"   # admin: create a device, prints its key
"""
import json
import math
import os
import random
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("API_BASE", "http://127.0.0.1:8788").rstrip("/")


def call(method, path, body=None, device_key=None, admin=False, timeout=10):
    headers = {"Content-Type": "application/json", "User-Agent": "utd-hackathon-26-client"}
    if device_key or os.environ.get("DEVICE_KEY"):
        headers["X-Device-Key"] = device_key or os.environ["DEVICE_KEY"]
    if admin:
        headers["Authorization"] = "Bearer " + os.environ["API_ADMIN_KEY"]
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {path} -> {e.code}: {e.read().decode()[:300]}") from None


def send(readings):
    """readings: list of {"sensor": str, "value": number|bool|str, "unit"?: str}"""
    return call("POST", "/api/ingest", {"readings": readings})


def event(type_, data=None):
    return call("POST", "/api/events", {"type": type_, "data": data or {}})


def demo():
    t0 = time.time()
    while True:
        t = time.time() - t0
        temp = 4 + 2 * math.sin(t / 30) + random.gauss(0, 0.1) + (6 if int(t) % 120 > 100 else 0)
        vib = abs(random.gauss(0.2, 0.05)) + (1.5 if int(t) % 90 > 80 else 0)
        print(send([
            {"sensor": "temp_c", "value": round(temp, 2), "unit": "C"},
            {"sensor": "vibration_g", "value": round(vib, 3), "unit": "g"},
        ]))
        time.sleep(2)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "demo"
    if cmd == "demo":
        demo()
    elif cmd == "register":
        print(json.dumps(call("POST", "/api/devices", {"name": sys.argv[2], "type": "pi"}, admin=True), indent=2))
    elif cmd == "health":
        print(json.dumps(call("GET", "/api/health"), indent=2))
    else:
        sys.exit(__doc__)
