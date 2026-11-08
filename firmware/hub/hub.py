#!/usr/bin/env python3
"""HomeBeacon neighborhood hub for the Arduino Uno Q (Linux side). Standard library only.

Box A is plugged into the Uno Q by USB. Box A prints `HB {json}` lines for every reading and
event (its own and box B's). This hub stores them in SQLite and serves a small local dashboard
that keeps working when the Internet is down. Box A uploads to the cloud itself; the hub is the
offline view and a second copy of the record.

    HUB_PASSWORD=choose-one python3 hub.py --port /dev/ttyACM0
    # then open http://<uno-q-ip>:8080  (user: hub, password: HUB_PASSWORD)

    python3 hub.py --selftest     # parses sample lines and checks the database, no hardware needed
"""
import argparse, base64, glob, hmac, html, json, os, re, sqlite3, subprocess, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DB = os.environ.get("HUB_DB", os.path.join(os.path.dirname(os.path.abspath(__file__)), "hub.sqlite"))
lock = threading.Lock()


def db():
    con = sqlite3.connect(DB, check_same_thread=False)
    con.execute("CREATE TABLE IF NOT EXISTS msgs (id INTEGER PRIMARY KEY, received REAL, box TEXT, type TEXT, event TEXT, body TEXT)")
    con.execute("CREATE INDEX IF NOT EXISTS msgs_box ON msgs(box, received)")
    return con


def parse_line(line):
    """Return the decoded message for an `HB {json}` line, else None (debug output is ignored)."""
    line = line.strip()
    if not line.startswith("HB "):
        return None
    try:
        msg = json.loads(line[3:])
    except json.JSONDecodeError:
        return None
    return msg if isinstance(msg, dict) and re.fullmatch(r"[A-Z0-9]{1,5}", str(msg.get("box", ""))) else None


def store(con, msg):
    with lock:
        con.execute("INSERT INTO msgs(received, box, type, event, body) VALUES (?,?,?,?,?)",
                    (time.time(), msg.get("box"), msg.get("type"), msg.get("event"), json.dumps(msg)))
        con.execute("DELETE FROM msgs WHERE id < (SELECT MAX(id) - 50000 FROM msgs)")  # bounded size
        con.commit()


def open_serial(port):
    """Open the tty without pyserial: configure with stty, then read raw bytes."""
    subprocess.run(["stty", "-F", port, "115200", "raw", "-echo"], check=False)
    return open(port, "rb", buffering=0)


def reader(con, port):
    while True:
        p = port or next(iter(sorted(glob.glob("/dev/ttyACM*") + glob.glob("/dev/ttyUSB*"))), None)
        if not p:
            print("[hub] waiting for box A on USB...", flush=True); time.sleep(3); continue
        try:
            f = open_serial(p); print(f"[hub] reading {p}", flush=True)
            buf = b""
            while True:
                chunk = f.read(256)
                if not chunk:
                    time.sleep(0.05); continue
                buf += chunk
                while b"\n" in buf:
                    raw, buf = buf.split(b"\n", 1)
                    msg = parse_line(raw.decode("utf-8", "replace"))
                    if msg:
                        store(con, msg)
        except OSError as e:
            print(f"[hub] serial error {e}; retrying", flush=True); time.sleep(2)


def page(con):
    with lock:
        latest = {r[0]: json.loads(r[1]) | {"_age": time.time() - r[2]} for r in con.execute(
            "SELECT box, body, received FROM msgs WHERE type='reading' AND id IN (SELECT MAX(id) FROM msgs WHERE type='reading' GROUP BY box)")}
        events = con.execute("SELECT received, box, event FROM msgs WHERE type='event' ORDER BY id DESC LIMIT 40").fetchall()
    def card(box):
        m = latest.get(box)
        if not m:
            return f"<section><h2>Box {box}</h2><p class=warn>No data yet</p></section>"
        stale = m["_age"] > 30
        rows = "".join(f"<tr><th>{html.escape(k)}</th><td>{html.escape(str(v))}</td></tr>" for k, v in m.items() if not k.startswith("_") and k not in ("box", "type"))
        return f"<section><h2>Box {box} {'<span class=warn>SILENT</span>' if stale else '<span class=ok>live</span>'}</h2><p>last report {int(m['_age'])} s ago</p><table>{rows}</table></section>"
    ev = "".join(f"<li><time>{time.strftime('%H:%M:%S', time.localtime(t))}</time> box {html.escape(b)}: <b>{html.escape(e or '')}</b></li>" for t, b, e in events)
    return f"""<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<meta http-equiv=refresh content=3><title>HomeBeacon hub</title>
<style>body{{font:15px system-ui;margin:16px;background:#111;color:#eee}}section{{background:#1d1d1d;padding:12px;border-radius:8px;margin-bottom:12px}}
th{{text-align:left;padding-right:12px;color:#aaa;font-weight:400}}.warn{{color:#ff6b6b}}.ok{{color:#6bcf7f}}li{{margin:4px 0}}time{{color:#888}}</style>
<h1>HomeBeacon neighborhood hub</h1><p>Local view of every box on the mesh; works without Internet. Silent = no report for 30 s (unknown, not safe). <b>hops</b> = boxes a message passed through; <b>gateway</b> = box uploading to the cloud.</p>
{''.join(card(b) for b in sorted(latest) or ['A'])}<section><h2>Recent events</h2><ul>{ev or '<li>none yet</li>'}</ul></section>"""


def make_handler(con, password):
    expected = "Basic " + base64.b64encode(f"hub:{password}".encode()).decode()
    class H(BaseHTTPRequestHandler):
        def do_GET(self):
            if not hmac.compare_digest(self.headers.get("Authorization", ""), expected):
                self.send_response(401); self.send_header("WWW-Authenticate", 'Basic realm="HomeBeacon hub"'); self.end_headers(); return
            body = (json.dumps([dict(zip(("received", "box", "type", "event", "body"), r)) for r in con.execute("SELECT received, box, type, event, body FROM msgs ORDER BY id DESC LIMIT 200")])
                    if self.path == "/api/recent" else page(con)).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json" if self.path == "/api/recent" else "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store"); self.end_headers(); self.wfile.write(body)
        def log_message(self, *a): pass
    return H


def selftest():
    global DB
    DB = ":memory:"
    con = db()
    ok = parse_line('HB {"box":"B","type":"event","event":"flame.detected"}')
    assert ok and ok["event"] == "flame.detected"
    assert parse_line("[wifi] connecting...") is None
    assert parse_line('HB {"box":"bad id!"}') is None and parse_line("HB {broken") is None
    assert parse_line('HB {"box":"C","type":"reading","hops":2}')["hops"] == 2
    store(con, ok); store(con, {"box": "A", "type": "reading", "water": True})
    store(con, {"box": "C", "type": "reading", "hops": 2, "gateway": "A"})
    out = page(con)
    assert "flame.detected" in out and "Box A" in out and "Box C" in out
    print("hub selftest PASS")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", help="serial device (default: first /dev/ttyACM* or /dev/ttyUSB*)")
    ap.add_argument("--http", type=int, default=8080)
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        selftest(); sys.exit(0)
    pw = os.environ.get("HUB_PASSWORD")
    if not pw or len(pw) < 8:
        sys.exit("Set HUB_PASSWORD (8+ characters) so the local dashboard is not open to everyone on the network.")
    con = db()
    threading.Thread(target=reader, args=(con, a.port), daemon=True).start()
    print(f"[hub] dashboard on http://0.0.0.0:{a.http} (user: hub)", flush=True)
    ThreadingHTTPServer(("0.0.0.0", a.http), make_handler(con, pw)).serve_forever()
