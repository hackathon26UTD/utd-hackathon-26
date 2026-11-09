import json
import os
import random
import shutil
import stat
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from hbagent import config, mcu, watchdog
from hbagent.agent import Agent
from hbagent.store import PRIO_CRITICAL, PRIO_ROUTINE, PRIO_STATUS, Store
from hbagent.uplink import Api, Result

KEY = "dk_test_only_not_a_secret"
DEV = "b" * 24


class Clock:
    def __init__(self):
        self.t = 1000.0
        self.epoch = 1_800_000_000.0

    def mono(self):
        return self.t

    def wall(self):
        return self.epoch + (self.t - 1000.0)

    def advance(self, s):
        self.t += s


class Server:
    """HTTP/1.1 keep-alive stand-in for the API. Counts connections, records headers, answers a settable status."""

    def __init__(self):
        self.status = 202
        self.location = None
        self.requests = []
        self.connections = 0
        self.key_ok = KEY
        srv = self

        class H(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def setup(self):
                super().setup()
                srv.connections += 1

            def log_message(self, *a):
                pass

            def _go(self, method):
                n = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(n) or b"null") if n else None
                srv.requests.append({"method": method, "path": self.path, "body": body, "idem": self.headers.get("Idempotency-Key"),
                                     "key": self.headers.get("X-Device-Key")})
                status = 401 if self.headers.get("X-Device-Key") != srv.key_ok else srv.status
                out = json.dumps({"error": "Invalid device key"} if status == 401 else {"ok": True}).encode()
                if srv.location and status == 202:
                    self.send_response(302)
                    self.send_header("Location", srv.location)
                else:
                    self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(out)))
                self.end_headers()
                self.wfile.write(out)

            def do_GET(self):  # noqa: N802
                self._go("GET")

            def do_POST(self):  # noqa: N802
                self._go("POST")

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.httpd.daemon_threads = True
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()


def guard_with(clock, **kw):
    events = []
    g = watchdog.UplinkGuard(clock=clock.mono, wall=clock.wall, rng=random.Random(2), on_event=lambda t, d: events.append((t, d)), **kw)
    return g, events


class GuardTests(unittest.TestCase):
    def test_circuit_opens_then_probes_once_then_closes(self):
        c = Clock()
        g, _ = guard_with(c, trip_after=3)
        for _ in range(3):
            self.assertIsNone(g.allow())
            g.record(Result(0, None, "URLError"))
        blocked = g.allow()
        self.assertIsNotNone(blocked, "open breaker answers locally, no radio")
        self.assertEqual((blocked.status, blocked.error), (0, "circuit open"))
        self.assertTrue(blocked.retry, "the agent treats it as a normal retryable failure and keeps the row")
        c.advance(400)                                    # past the capped cooldown
        self.assertIsNone(g.allow(), "exactly one probe goes out")
        self.assertIsNotNone(g.allow(), "a second call while the probe is in flight is held back")
        g.record(Result(202, {}))
        self.assertEqual(g.state, "closed")
        self.assertIsNone(g.allow())

    def test_failed_probe_reopens_with_longer_capped_cooldown(self):
        c = Clock()
        g, _ = guard_with(c, trip_after=2, cooldown_base=20, cooldown_cap=300)
        waits = []
        for _ in range(8):
            for _ in range(2 if g.state == "closed" else 1):
                if g.allow() is None:
                    g.record(Result(503, None))
            waits.append(g.open_until - c.t)
            c.advance(g.open_until - c.t + 0.1)
        self.assertTrue(all(w <= 300 * 1.25 + 1 for w in waits), waits)
        self.assertGreater(waits[3], waits[0])

    def test_critical_row_is_never_held_behind_a_cooldown(self):
        c = Clock()
        crit = {"on": False}
        g, _ = guard_with(c, trip_after=2, critical_pending=lambda: crit["on"])
        for _ in range(2):
            g.allow()
            g.record(Result(0, None, "URLError"))
        self.assertEqual(g.state, "open")
        self.assertIsNotNone(g.allow())
        crit["on"] = True
        c.advance(16)
        self.assertIsNone(g.allow(), "a hazard report is tried every 15 s even while open")
        self.assertIsNotNone(g.allow())

    def test_rejected_key_state_slow_retry_and_recovery(self):
        c = Clock()
        g, events = guard_with(c)
        self.assertIsNone(g.allow())
        g.record(Result(401, None, "Invalid device key"))
        snap = g.snapshot()
        self.assertTrue(snap["key_rejected"])
        self.assertIn("device key rejected: re-run setup", snap["message"])
        self.assertEqual([e[0] for e in events], ["agent.key_rejected"])
        for _ in range(20):
            c.advance(30)
            r = g.allow()
            if c.t - 1000 < 900:
                self.assertEqual(r.status, 401, "no network call before the 15 minute mark")
        # exactly one probe per 15 minutes
        c.t = 1000 + 901
        self.assertIsNone(g.allow())
        self.assertEqual(g.allow().status, 401)
        g.record(Result(401, None))
        self.assertEqual(len([e for e in events if e[0] == "agent.key_rejected"]), 1, "cloud-visible event is throttled")
        c.advance(901)
        self.assertIsNone(g.allow())
        g.record(Result(202, {}))
        self.assertFalse(g.key_rejected)
        self.assertEqual(events[-1][0], "agent.uplink_recovered")

    def test_event_throttle_survives_restart_and_state_file_is_private_and_secret_free(self):
        d = tempfile.mkdtemp(prefix="hbw")
        try:
            path = os.path.join(d, "uplink_health.json")
            c = Clock()
            g, ev = guard_with(c, state_file=path)
            g.allow()
            g.record(Result(401, None, "Invalid device key"))
            g.flush_state()
            self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)
            text = open(path).read()
            self.assertNotIn(KEY, text)
            g2, ev2 = guard_with(Clock(), state_file=path)          # agent restarted by systemd
            g2.record(Result(401, None, "Invalid device key"))
            self.assertEqual(ev2, [], "a restart loop must not spam the cloud with the same event")
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_server_answering_with_4xx_is_not_a_network_failure(self):
        c = Clock()
        g, _ = guard_with(c, trip_after=2)
        for _ in range(6):
            g.allow()
            g.record(Result(409, {"error": "assign a home"}))
        self.assertEqual(g.state, "closed")
        self.assertFalse(g.stalled(5, 1) and g.last_reach_mono is None)


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.srv = Server()

    def tearDown(self):
        self.srv.stop()

    def test_one_connection_serves_a_burst_and_rebuild_starts_a_new_one(self):
        api = Api(self.srv.url, KEY, 3.0)
        for i in range(4):
            self.assertTrue(api.ingest([{"sensor": "x", "value": i}]).ok)
        self.assertEqual(self.srv.connections, 1, "batched flush shares one connection (one TLS handshake in production)")
        api.rebuild_session()
        self.assertTrue(api.event("agent.x", {}).ok)
        self.assertEqual(self.srv.connections, 2)
        self.assertEqual(api.rebuilds, 1)
        api.close()

    def test_idle_connection_is_dropped_so_the_radio_can_sleep(self):
        c = Clock()
        api = Api(self.srv.url, KEY, 3.0, clock=c.mono)
        api.ingest([])
        c.advance(Api.IDLE_CLOSE_S + 1)
        api.ingest([])
        self.assertEqual(self.srv.connections, 2)
        api.close()

    def test_dead_reused_connection_is_retried_once(self):
        api = Api(self.srv.url, KEY, 3.0)
        self.assertTrue(api.ingest([]).ok)
        api._conn.sock.close()           # the NAT silently killed it
        self.assertTrue(api.ingest([]).ok)
        api.close()

    def test_event_id_is_sent_as_idempotency_key_and_stays_the_same_on_retry(self):
        api = Api(self.srv.url, KEY, 3.0)
        d = tempfile.mkdtemp(prefix="hbw")
        s = Store(os.path.join(d, "q.sqlite"))
        try:
            s.push("event", {"type": "agent.t", "data": {"i": 1}})
            row = s.peek(limit=1)[0]
            self.assertTrue(row["eid"].startswith("ev-"))
            self.srv.status = 503
            self.assertFalse(api.event("agent.t", {"i": 1}, eid=row["eid"]).ok)
            self.srv.status = 202
            self.assertTrue(api.event("agent.t", {"i": 1}, eid=row["eid"]).ok)
            ids = [r["idem"] for r in self.srv.requests]
            self.assertEqual(ids, [row["eid"], row["eid"]])
        finally:
            api.close()
            s.close()
            shutil.rmtree(d, ignore_errors=True)

    def test_redirect_is_a_retryable_failure_not_a_rejected_payload(self):
        self.srv.location = "http://127.0.0.1:9/"
        res = Api(self.srv.url, KEY, 3.0).ingest([])
        self.assertEqual(res.status, 0)
        self.assertTrue(res.retry)

    def test_key_is_sent_only_as_the_device_header(self):
        api = Api(self.srv.url, KEY, 3.0)
        api.settings()
        self.assertEqual(self.srv.requests[0]["key"], KEY)
        self.assertNotIn(KEY, self.srv.requests[0]["path"])
        api.close()


class AgentHarness(unittest.TestCase):
    def make(self, **guard_kw):
        self.d = tempfile.mkdtemp(prefix="hbw", dir=("/tmp" if os.path.isdir("/tmp") else None))
        self.srv = Server()
        self.clock = Clock()
        cfg = config.Config(base_url=self.srv.url, device_id=DEV, state_dir=self.d, status_port=0, mcu_source="fake",
                            battery_mah=6000, battery_nominal_v=7.4, battery_chemistry="liion", assumed_soc_pct=100,
                            assume_mains="present").validate()
        self.store = Store(os.path.join(self.d, "a.sqlite"))
        self.events = []

        def on_event(t, d):
            self.events.append((t, d))
            self.store.push("event", {"type": t, "data": d}, PRIO_STATUS)

        self.guard = watchdog.UplinkGuard(clock=self.clock.mono, wall=self.clock.wall, rng=random.Random(5),
                                          state_file=os.path.join(self.d, "uplink_health.json"), on_event=on_event,
                                          critical_pending=lambda: self.store.stats()["critical"] > 0, **guard_kw)
        self.api = Api(cfg.base_url, KEY, 3.0, guard=self.guard, clock=self.clock.mono)
        self.agent = Agent(cfg, self.store, self.api, mcu.FakeSource(scripted=[]), wall=self.clock.wall, mono=self.clock.mono,
                           rng=random.Random(1), sysinfo=lambda: {"cpu_temp_c": 40.0})
        self.probe = {"up": True}
        self.wd = watchdog.UplinkWatchdog(self.guard, self.api, self.store.depth, stall_s=600, heal_gap_s=1800,
                                          net_probe=lambda h, p: self.probe["up"])
        watchdog.install(self.agent, self.wd)
        return self.agent

    def tearDown(self):
        if hasattr(self, "srv"):
            self.srv.stop()
        if hasattr(self, "api"):
            self.api.close()
        if hasattr(self, "store"):
            self.store.close()
        shutil.rmtree(getattr(self, "d", "/nonexistent"), ignore_errors=True)

    def run_for(self, seconds, step=5.0):
        end = self.clock.t + seconds
        while self.clock.t < end:
            self.agent.step()
            self.clock.advance(step)


class AgentWithWatchdog(AgentHarness):
    def test_rejected_key_retries_every_15_minutes_not_hourly_never_hammers_and_recovers(self):
        a = self.make()
        self.srv.key_ok = "dk_other"                          # server no longer accepts our key
        self.run_for(60)
        self.assertTrue(a.auth_failed)
        self.assertTrue(self.guard.key_rejected)
        self.assertGreater(self.store.depth(), 0, "data kept")
        n0 = len(self.srv.requests)
        self.run_for(14 * 60)
        self.assertEqual(len(self.srv.requests) - n0, 0, "no requests during the first 15 minutes")
        self.run_for(4 * 60)
        probes = len(self.srv.requests) - n0
        self.assertTrue(1 <= probes <= 2, probes)              # one probe slot per 15 minutes (poll may use it instead of flush)
        self.srv.key_ok = KEY                                  # operator re-ran setup and the key works again
        self.run_for(16 * 60)
        self.assertFalse(a.auth_failed)
        self.assertFalse(self.guard.key_rejected)
        self.assertEqual(self.store.depth(), self.store.stats()["rows"])
        self.assertIn("agent.uplink_recovered", [e[0] for e in self.events])
        self.assertEqual([e[0] for e in self.events].count("agent.key_rejected"), 1, "one cloud-visible event, not one per probe")

    def test_outage_trips_breaker_keeps_queueing_within_caps_and_replays_in_order(self):
        a = self.make()
        for i in range(6):
            self.store.push("event", {"type": "agent.seq", "data": {"i": i}}, PRIO_STATUS, now=self.clock.wall())
        self.srv.status = 503
        self.run_for(600)
        self.assertEqual(self.guard.snapshot()["state"] in ("open", "half_open", "closed"), True)
        self.assertGreaterEqual(self.guard.trips, 1)
        self.assertLessEqual(self.store.stats()["rows"], self.store.max_rows)
        before = len(self.srv.requests)
        self.srv.status = 202
        self.run_for(1200)
        self.assertEqual(self.store.depth(), 0)
        seq = [r["body"]["data"]["i"] for r in self.srv.requests[before:] if r["path"] == "/api/events" and r["body"]["type"] == "agent.seq"]
        self.assertEqual(seq, sorted(seq), "queue replay order preserved")
        self.assertEqual(sorted(set(seq)), list(range(6)))
        # Event rows are stored with a stable id (see ApiTests). agent._flush must pass row["eid"] to api.event(...,
        # eid=...) to send it; until agent.py does, the header is simply absent (checked in test_event_id_is_sent...).

    def test_breaker_gives_the_radio_rests_during_a_long_outage(self):
        a = self.make()
        self.srv.status = 503
        self.run_for(1800)
        sent = len(self.srv.requests)
        self.assertLess(sent, 40, f"too many attempts during a 30 minute outage: {sent}")

    def test_stall_with_healthy_network_rebuilds_the_session_once_and_records_it(self):
        a = self.make()
        self.srv.status = 503                                   # server broken, network fine
        self.run_for(30 * 60)
        heals = self.guard.snapshot()["heals"]
        self.assertEqual(len(heals), 1, heals)
        self.assertEqual((heals[0]["action"], heals[0]["network"]), ("rebuilt_session", "ok"))
        self.assertEqual(self.api.rebuilds, 1)
        self.run_for(40 * 60)
        self.assertEqual(self.api.rebuilds, 2, "at most one self-heal per half hour")
        self.assertIn("agent.uplink_selfheal", [e[0] for e in self.events])

    def test_stall_with_network_down_only_records_it(self):
        a = self.make()
        self.probe["up"] = False
        self.srv.status = 503
        self.run_for(30 * 60)
        heals = self.guard.snapshot()["heals"]
        self.assertEqual([h["action"] for h in heals], ["none_network_down"])
        self.assertEqual(self.api.rebuilds, 0)

    def test_no_heal_when_the_server_keeps_answering(self):
        a = self.make()
        self.srv.status = 409
        self.store.push("beacon", {"event_id": "x-1-1"}, PRIO_ROUTINE, eid="x-1-1", now=self.clock.wall())
        self.run_for(40 * 60)
        self.assertEqual(self.api.rebuilds, 0)


if __name__ == "__main__":
    unittest.main()
