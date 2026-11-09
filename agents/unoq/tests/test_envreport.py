import json
import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

from hbagent import envreport as E
from hbagent import live

KEY = "hbk_live_0123456789abcdef0123456789abcdef0123456789abcdef"


def w(root, rel, text):
    p = os.path.join(root, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w") as f:
        f.write(text)


def fake_roots(tmp):
    proc, sys_, etc, dev = (os.path.join(tmp, n) for n in ("proc", "sys", "etc", "dev"))
    w(proc, "uptime", "7200.5 100.0\n")
    w(proc, "meminfo", "MemTotal: 2048000 kB\nMemAvailable: 1024000 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n")
    w(proc, "cpuinfo", "processor : 0\nmodel name : ARM Cortex-A53\n")
    w(proc, "net/route", "Iface\tDestination\tGateway\tFlags\nwlan0\t00000000\t0101A8C0\t0003\n")
    w(proc, "net/wireless", "Inter-| sta-|   Quality\n face | tus | link level noise\n wlan0: 0000   58.  -52.  -256 0 0 0 0 0 0\n")
    w(proc, "self/status", "VmRSS:\t   30720 kB\nThreads:\t4\n")
    w(etc, "os-release", 'PRETTY_NAME="Debian GNU/Linux 12"\nVERSION_ID="12"\nID=debian\n')
    w(etc, "resolv.conf", "nameserver 192.168.1.1\nnameserver 1.1.1.1\n")
    w(sys_, "class/thermal/thermal_zone0/temp", "51500\n")
    w(sys_, "class/thermal/thermal_zone0/type", "cpu\n")
    w(sys_, "bus/usb/devices/1-1/idVendor", "2341\n")
    w(sys_, "bus/usb/devices/1-1/idProduct", "0043\n")
    w(sys_, "bus/usb/devices/1-1/product", "Arduino Uno\n")
    w(dev, "ttyACM0", "")
    return proc, sys_, etc, dev


def fake_run(argv, timeout=2.0):
    a = argv[0]
    if a == "timedatectl":
        return "NTPSynchronized=yes\nNTP=yes\nTimezone=UTC\n"
    if a == "ip":
        return json.dumps([{"ifname": "lo", "operstate": "UNKNOWN", "addr_info": [{"local": "127.0.0.1"}]},
                           {"ifname": "wlan0", "operstate": "UP", "addr_info": [{"local": "192.168.1.50"}, {"local": "fe80::1"}]}])
    if a == "iw":
        return "Connected to aa:bb\n\tSSID: MyHomeWifi\n\tsignal: -49 dBm\n"
    if a == "systemctl":
        return "ActiveState=active\nSubState=running\nUnitFileState=enabled\nNRestarts=2\n"
    return None                              # vcgencmd, nmcli: absent


PROBE = {"host": "x.example", "dns_ok": True, "dns_ms": 12, "tls_ok": True, "http_status": 200, "latency_ms": 90, "clock_skew_s": 1.2}
STATUS = {"mcu": {"source": "serial", "connected": True, "error": ""},
          "live": {"boxes": {"A": {"age_s": 7.0}, "B": {"age_s": 30.0}}},
          "power": {"mode": "eco", "server_mode": "eco", "hours_remaining": None, "confidence": "low", "load_basis": "assumption"}}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        proc, sys_, etc, dev = fake_roots(self.tmp)
        self.cfg = SimpleNamespace(device_id="a" * 24, state_dir=self.tmp, base_url="https://x.example", mcu_port="")
        self.patches = [mock.patch.object(E, "PROC", proc), mock.patch.object(E, "SYS", sys_), mock.patch.object(E, "ETC", etc),
                        mock.patch.object(E, "DEV", dev), mock.patch.object(E, "_run", fake_run)]
        for p in self.patches:
            p.start()
            self.addCleanup(p.stop)

    def env(self, **kw):
        return E.collect_environment(self.cfg, kw.pop("status", STATUS), kw.pop("store", None), api_probe=kw.pop("api_probe", PROBE), wall=lambda: 1_700_000_000.0, **kw)


class Collect(Base):
    def test_reads_fake_board(self):
        e = self.env()
        self.assertEqual(e["os"]["value"]["name"], "Debian GNU/Linux 12")
        self.assertEqual(e["memory"]["value"]["avail_mb"], 1000)
        self.assertEqual(e["temperature"]["value"]["max_c"], 51.5)
        self.assertEqual(e["uptime"]["value"]["uptime_s"], 7200)
        self.assertEqual(e["default_route"]["value"], {"iface": "wlan0", "gateway": "192.168.1.1"})
        self.assertEqual(e["dns"]["value"], ["192.168.1.1", "1.1.1.1"])
        self.assertEqual([i["name"] for i in e["interfaces"]["value"]], ["wlan0"])
        self.assertEqual(e["interfaces"]["value"][0]["addrs"], ["192.168.1.50"])    # no loopback, no link-local
        self.assertEqual(e["usb"]["value"][0]["id"], "2341:0043")
        self.assertEqual(e["serial"]["value"][0]["dev"], "ttyACM0")
        self.assertEqual(e["service"]["value"]["restarts"], 2)
        self.assertEqual(e["mcu"]["value"]["last_message_age_s"], 7)
        self.assertEqual(e["wifi"]["value"]["signal_dbm"], -49)
        self.assertEqual(e["clock"]["value"]["state"], "ok")

    def test_missing_is_unknown_never_a_guess(self):
        e = self.env()
        self.assertEqual(e["throttling"], {"value": "unknown", "source": "vcgencmd", "ok": False})
        self.assertIsNone(e["power"]["value"]["runway_h"])          # unknown runway stays unknown
        self.assertEqual(self.env(status={})["mcu"]["value"], "unknown")

    def test_ssid_and_host_are_hashed_unless_opted_in(self):
        raw = json.dumps(self.env())
        self.assertNotIn("MyHomeWifi", raw)
        self.assertIn("ssid_hash", raw)
        self.cfg.env_send_ssid = True
        self.assertEqual(self.env()["wifi"]["value"]["ssid"], "MyHomeWifi")

    def test_collectors_never_raise(self):
        def boom(*a, **k):
            raise RuntimeError("boom")
        with mock.patch.object(E, "_read", boom), mock.patch.object(E, "_run", boom), mock.patch.object(E.glob, "glob", boom):
            e = E.collect_environment(self.cfg, STATUS, None, probe=False)
        self.assertFalse(e["memory"]["ok"])
        self.assertEqual(e["os"]["value"], "unknown")
        self.assertIn("error", e["service"])

    def test_no_secret_anywhere(self):
        os.environ["HB_DEVICE_KEY"] = KEY
        self.addCleanup(os.environ.pop, "HB_DEVICE_KEY", None)
        st = dict(STATUS, mcu={"source": "serial", "connected": False, "error": f"open failed X-Device-Key: {KEY}"})
        e = self.env(status=st)
        ev = E.build_environment_event(e)
        for blob in (json.dumps(e), json.dumps(ev), E.render_environment_text(e)):
            self.assertNotIn(KEY, blob)
            self.assertNotIn("0123456789abcdef0123", blob)

    def test_real_collect_on_this_machine_is_bounded(self):
        for p in self.patches:
            p.stop()
        self.addCleanup(lambda: [p.start() for p in self.patches])
        e = E.collect_environment(self.cfg, STATUS, None, probe=False)
        self.assertLess(len(json.dumps(e)), 20_000)
        self.assertTrue(e["python"]["ok"])
        self.assertTrue(E.render_environment_text(e))


class Probe(unittest.TestCase):
    def test_dns_failure_reported(self):
        with mock.patch.object(E.socket, "getaddrinfo", side_effect=OSError("no dns")):
            r = E.probe_api("https://nope.invalid", timeout=1)
        self.assertFalse(r["dns_ok"])
        self.assertIsNone(r["http_status"])

    def test_probe_sends_no_key(self):
        sent = {}

        class Conn:
            def __init__(self, *a, **k): pass
            def connect(self): pass
            def request(self, m, p, headers=None): sent.update(headers or {}, path=p)
            def getresponse(self):
                return SimpleNamespace(status=200, read=lambda n: b"", getheader=lambda h: "Wed, 21 Oct 2015 07:28:00 GMT")
            def close(self): pass
        with mock.patch.object(E.socket, "getaddrinfo", return_value=[1]), mock.patch.object(E.http.client, "HTTPSConnection", Conn):
            r = E.probe_api("https://x.example")
        self.assertEqual(sent["path"], "/api/ready")
        self.assertFalse(any("key" in k.lower() or "auth" in k.lower() for k in sent))
        self.assertEqual(r["http_status"], 200)
        self.assertGreater(abs(r["clock_skew_s"]), 1000)            # the fake server date is far in the past


class Event(Base):
    def test_event_is_compact_and_typed(self):
        ev = E.build_environment_event(self.env())
        self.assertEqual(ev["type"], "agent.environment")
        self.assertLess(len(json.dumps(ev["data"])), 4096)
        self.assertIsNone(ev["data"]["runway_h"])
        self.assertIsNone(ev["data"]["throttled"])
        self.assertEqual(ev["data"]["mcu_msg_age_s"], 7)

    def test_event_stays_small_with_hostile_input(self):
        e = self.env()
        e["interfaces"] = {"value": [{"name": "x" * 99, "state": "up", "addrs": ["10.0.0.%d" % i] * 3} for i in range(50)], "source": "t", "ok": True}
        e["os"] = {"value": {"name": "Z" * 5000}, "source": "t", "ok": True}
        e["serial"] = {"value": [{"dev": "ttyACM%d" % i, "agent_can_open": True} for i in range(200)], "source": "t", "ok": True}
        self.assertLess(len(json.dumps(E.build_environment_event(E.scrub(e))["data"])), 4096)
        self.assertLess(len(json.dumps(E.build_environment_event({})["data"])), 4096)
        self.assertLess(len(json.dumps(E.build_environment_event("junk")["data"])), 4096)


class Schedule(Base):
    def data(self, **over):
        d = E.build_environment_event(self.env())["data"]
        d.update(dict({"disk_free_pct": 50.0}, **over))
        return d

    def test_rules(self):
        d = self.data()
        prev = {"at": 1000.0, "data": d}
        self.assertTrue(E.should_upload_environment(None, d, 1000))                          # first ever
        self.assertFalse(E.should_upload_environment(prev, self.data(), 1000 + 3600))        # same, 1 h
        self.assertTrue(E.should_upload_environment(prev, self.data(), 1000 + 6 * 3600))     # 6 h
        self.assertFalse(E.should_upload_environment(prev, self.data(disk_free_pct=2.0), 1000 + 60))      # change, too soon
        self.assertTrue(E.should_upload_environment(prev, self.data(disk_free_pct=2.0), 1000 + 1000))     # significant change
        self.assertTrue(E.should_upload_environment(prev, self.data(mcu_connected=False), 1000 + 1000))
        self.assertFalse(E.should_upload_environment(prev, self.data(uptime_s=99999, load1=3.0, mem_avail_mb=1), 1000 + 1000))  # noise
        self.assertTrue(E.should_upload_environment(prev, d, 1000 + 400, boot=True))         # boot
        self.assertFalse(E.should_upload_environment(prev, d, 1000 + 100, boot=True))        # crash loop guard
        self.assertTrue(E.should_upload_environment(prev, d, 500))                           # clock went back

    def test_reporter_boot_then_quiet_then_change(self):
        t = [1000.0]
        store = SimpleNamespace(d={}, get=lambda k, dflt=None: store.d.get(k, dflt), put=lambda k, v: store.d.__setitem__(k, v), stats=lambda: {"rows": 3, "oldest": 900.0})
        calls = []

        def coll(cfg, status, st, probe=True, api_probe=None, wall=None):
            calls.append(probe)
            return self.env(store=st)
        r = E.EnvReporter(self.cfg, store, lambda: STATUS, wall=lambda: t[0], collector=coll)
        self.assertEqual(r.tick()["type"], "agent.environment")       # boot
        t[0] += 60
        self.assertIsNone(r.tick())
        n = len(calls)
        t[0] += 60
        self.assertIsNone(r.tick())
        self.assertEqual(len(calls), n)                                # cheap while nothing can be due
        self.assertIn("env_last_upload", store.d)
        self.assertEqual(calls.count(True), 1)                         # API probe done once, then cached
        r2 = E.EnvReporter(self.cfg, store, lambda: STATUS, wall=lambda: t[0] + 10, collector=coll)
        self.assertIsNone(r2.tick())                                   # restart soon after: no second boot upload

    def test_snapshot_is_cached(self):
        n = []
        r = E.EnvReporter(self.cfg, None, None, wall=lambda: 5.0, collector=lambda *a, **k: n.append(1) or {"x": 1})
        r.snapshot(); r.snapshot()
        self.assertEqual(len(n), 1)


class Masking(unittest.TestCase):
    def test_masks(self):
        cases = [f"X-Device-Key: {KEY}", f"Authorization: Bearer {KEY}", "https://user:pw123@host/x", "password=hunter2 ok",
                 "token: abcDEF123456", "psk=secretpsk", "a" * 64, "AbCd1234" * 8]
        for c in cases:
            m = E.mask_secrets(c)
            for bad in (KEY, "pw123", "hunter2", "abcDEF123456", "secretpsk", "a" * 64, "AbCd1234" * 8):
                self.assertNotIn(bad, m)
        self.assertEqual(E.mask_secrets("/opt/homebeacon-unoq/releases/0.1.0/hbagent"), "/opt/homebeacon-unoq/releases/0.1.0/hbagent")
        self.assertEqual(E.mask_secrets("wlan0 up 192.168.1.50"), "wlan0 up 192.168.1.50")
        self.assertIn("***", E.mask_secrets("blah", secrets=("blah",)))
        self.assertIsInstance(E.mask_secrets(None), str)

    def test_scrub_nested(self):
        out = E.scrub({"a": [{"b": f"key={KEY}"}], "n": 3})
        self.assertNotIn(KEY, json.dumps(out))
        self.assertEqual(out["n"], 3)


class Display(Base):
    def test_text_and_live(self):
        e = self.env()
        text = E.render_environment_text(e)
        for want in ("Debian GNU/Linux 12", "runway unknown", "Power flags: unknown", "can open"):
            self.assertIn(want, text)
        self.assertNotIn("\u2014", text)
        self.assertNotIn("MyHomeWifi", text)
        st = {"version": "x", "uptime_s": 1, "env": e}
        out = live.render(st)
        self.assertIn("Env: clock skew 1.2 s", out)
        live.render({"version": "x", "uptime_s": 1, "env": {"schema": 1}})      # empty env must not crash
        self.assertEqual(E.main(["--json", "--no-probe"], self.cfg, out=__import__("io").StringIO()), 0)


if __name__ == "__main__":
    unittest.main()
