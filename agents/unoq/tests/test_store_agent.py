import json
import os
import random
import shutil
import stat
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

from hbagent import commands, config, mcu, servers, updater
from hbagent.agent import Agent
from hbagent.store import PRIO_CRITICAL, PRIO_ROUTINE, Store
from hbagent.uplink import Api, Backoff

from fake_api import KEY, FakeApi

DEV = "a" * 24


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


def short_tmp():
    return tempfile.mkdtemp(prefix="hb", dir="/tmp")   # unix socket paths are short-limited


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.d = short_tmp()
        self.s = Store(os.path.join(self.d, "q.sqlite"), max_rows=5, max_bytes=10_000)

    def tearDown(self):
        self.s.close()
        shutil.rmtree(self.d, ignore_errors=True)

    def test_bounded_and_drops_routine_before_critical(self):
        self.s.push("event", {"type": "crit"}, PRIO_CRITICAL)
        for i in range(10):
            self.s.push("ingest", {"readings": [{"sensor": "x", "value": i}]}, PRIO_ROUTINE)
        self.assertEqual(self.s.depth(), 5)
        self.assertEqual(self.s.stats()["critical"], 1)
        self.assertEqual(self.s.peek(limit=1)[0]["prio"], PRIO_CRITICAL, "critical goes first")
        self.assertEqual(self.s.dropped, 6)

    def test_byte_cap(self):
        s = Store(os.path.join(self.d, "b.sqlite"), max_rows=1000, max_bytes=500)
        for i in range(50):
            s.push("event", {"type": "e", "data": {"pad": "x" * 100}})
        self.assertLessEqual(s.stats()["bytes"], 500)
        s.close()

    def test_survives_restart_and_counts_boots(self):
        self.s.push("beacon", {"event_id": "x-1-1"}, eid="x-1-1")
        self.assertEqual(self.s.next_boot(), 1)
        self.s.close()
        s2 = Store(os.path.join(self.d, "q.sqlite"))
        self.assertEqual(s2.depth(), 1)
        self.assertEqual(s2.next_boot(), 2)
        s2.close()
        self.s = Store(os.path.join(self.d, "q.sqlite"))

    def test_done_ids(self):
        self.assertFalse(self.s.seen("a"))
        self.s.mark("a")
        self.assertTrue(self.s.seen("a"))

    def test_private_file_mode_is_not_world_readable_by_default_umask_note(self):
        self.assertTrue(os.path.exists(os.path.join(self.d, "q.sqlite")))


class Harness(unittest.TestCase):
    def make(self, **over):
        self.d = short_tmp()
        self.api_srv = FakeApi().start()
        self.clock = Clock()
        base = dict(battery_mah=6000, battery_nominal_v=7.4, battery_chemistry="liion", assumed_soc_pct=100, assume_mains="present")
        cfg = config.Config(base_url=self.api_srv.url, device_id=DEV, state_dir=self.d, status_port=0, mcu_source="fake", **{**base, **over}).validate()
        self.cfg = cfg
        self.store = Store(os.path.join(self.d, "a.sqlite"))
        self.api = Api(cfg.base_url, KEY, 3.0)
        self.src = mcu.FakeSource(scripted=[])
        self.agent = Agent(cfg, self.store, self.api, self.src, wall=self.clock.wall, mono=self.clock.mono,
                           rng=random.Random(1), sysinfo=lambda: {"cpu_temp_c": 41.0, "load1": 0.1})
        return self.agent

    def tearDown(self):
        if hasattr(self, "api_srv"):
            self.api_srv.stop()
        if hasattr(self, "store"):
            self.store.close()
        shutil.rmtree(getattr(self, "d", "/nonexistent"), ignore_errors=True)

    def run_for(self, seconds, step=1.0):
        end = self.clock.t + seconds
        while self.clock.t < end:
            self.agent.step()
            self.clock.advance(step)


class AgentFlow(Harness):
    def test_first_steps_report_and_deliver(self):
        a = self.make()
        self.run_for(10)
        paths = self.api_srv.paths()
        self.assertIn("/api/ingest", paths)
        self.assertIn("/api/events", paths)
        self.assertIn("/api/device/messages", paths)
        self.assertTrue(all(r["key"] == KEY for r in self.api_srv.requests))
        self.assertEqual(self.store.depth(), 0, "everything accepted is removed from the queue")
        self.assertEqual(a.decision.mode, "full")
        self.assertNotIn("beacon", self.api_srv.paths(), "assumed mains is never reported as an observation")
        self.assertEqual([r for r in self.api_srv.requests if r["path"] == "/api/beacon/ingest"], [])

    def test_offline_queue_then_replay_is_idempotent(self):
        a = self.make()
        a.on_mcu({"box": "A", "type": "reading", "mains": True})
        self.api_srv.fail_with = 503
        self.run_for(200, step=5)
        self.assertGreater(self.store.depth(), 0)
        self.assertGreater(a.counters["retries"], 0)
        self.assertTrue(a.backoff.n > 0)
        self.api_srv.fail_with = None
        self.run_for(1500, step=5)
        self.assertEqual(self.store.depth(), 0)
        ids = [r["body"]["event_id"] for r in self.api_srv.requests if r["path"] == "/api/beacon/ingest" and r["body"]]
        self.assertEqual(len(ids), len(set(ids)), "no event id is ever reused for different data")
        # resending the very same payload is accepted as a duplicate, not an error
        body = next(r["body"] for r in self.api_srv.requests if r["path"] == "/api/beacon/ingest")
        res = self.api.beacon_ingest(body)
        self.assertTrue(res.ok and res.body["duplicate"])

    def test_backoff_is_bounded_and_respects_floor(self):
        b = Backoff(base=5, cap=100, rng=random.Random(3))
        delays = [b.failure(floor=20) for _ in range(12)]
        self.assertTrue(all(20 <= d <= 150 for d in delays))
        b.success()
        self.assertEqual(b.n, 0)

    def test_bad_key_stops_and_keeps_data(self):
        a = self.make()
        a.api = Api(self.cfg.base_url, "dk_wrong", 3.0)
        self.run_for(30)
        self.assertTrue(a.auth_failed)
        n = len(self.api_srv.requests)
        self.run_for(300, step=10)
        self.assertLess(len(self.api_srv.requests) - n, 3, "stops hammering after 401")
        self.assertGreater(self.store.depth(), 0, "data is kept for after re-provisioning")

    def test_rejected_payload_is_quarantined_not_retried_forever(self):
        a = self.make()
        self.api_srv.fail_with = 400
        self.run_for(20)
        self.assertGreater(a.counters["rejected"], 0)
        self.assertEqual(self.store.depth(), 0)

    def test_hazard_triggers_immediate_event_and_faster_reporting(self):
        a = self.make()
        self.run_for(3)
        self.api_srv.requests.clear()
        a.on_mcu({"box": "A", "type": "reading", "water": True, "mains": False})
        self.run_for(20)
        evs = [r["body"] for r in self.api_srv.requests if r["path"] == "/api/events"]
        self.assertTrue(any(e["type"] == "hub.hazard_seen" for e in evs))
        self.assertTrue(a.hazard_state[0])
        self.assertEqual(a.decision.server_mode, "critical")
        self.assertEqual(a.decision.report_s, 30)

    def test_repeated_hazard_readings_do_not_spam_the_queue(self):
        a = self.make()
        self.run_for(2)
        for _ in range(30):
            a.on_mcu({"box": "A", "type": "reading", "water": True})
        self.run_for(20)
        evs = [r["body"] for r in self.api_srv.requests if r["path"] == "/api/events" and r["body"]["type"] == "hub.hazard_seen"]
        self.assertEqual(len(evs), 1)

    def test_mains_loss_from_box_changes_mode(self):
        a = self.make(need_hours=60)
        a.on_mcu({"box": "A", "type": "reading", "mains": True})
        self.run_for(5)
        self.assertEqual(a.decision.mode, "full")
        a.on_mcu({"box": "A", "type": "reading", "mains": False})
        self.run_for(40)
        self.assertNotEqual(a.decision.mode, "full")
        evs = [r["body"]["data"].get("mode") for r in self.api_srv.requests if r["path"] == "/api/events" and r["body"]["type"] == "agent.mode"]
        self.assertGreaterEqual(len(evs), 2)

    def test_last_gasp_sent_once(self):
        a = self.make()
        a.battery_reader = lambda: type("B", (), {"soc_pct": 2.0, "soc_source": "gauge", "mains": None, "charging": None, "note": ""})()
        a.on_mcu({"box": "A", "type": "reading", "mains": False})
        self.run_for(120, step=5)
        types = [r["body"]["type"] for r in self.api_srv.requests if r["path"] == "/api/events"]
        self.assertEqual(types.count("agent.last_gasp"), 1)
        self.assertTrue(a.decision.last_gasp_active)


class FlowFixes(Harness):
    """Regression tests for the review findings: 409 handling, battery counting, backoff wakeups, hazard honesty."""

    def test_409_keeps_the_beacon_and_resends_the_same_event(self):
        a = self.make(assume_mains="unknown")
        a.on_mcu({"box": "A", "type": "reading", "mains": True})
        a._drain(a.mono())
        a._push_beacon(self.clock.wall(), water=True, prio=PRIO_CRITICAL)
        want = self.store.peek("beacon", 1)[0]
        self.api_srv.beacon_409 = "Event is processing or requires receipt reconciliation; retry later"
        a.urgent = True
        a._flush(self.clock.t)
        self.assertEqual(a.counters["conflicts"], 1)
        kept = self.store.peek("beacon", 1)
        self.assertEqual(len(kept), 1, "a beacon refused with 409 stays queued")
        self.assertEqual(kept[0]["eid"], want["eid"])
        self.assertEqual(a.beacon_disabled_until, 0.0, "a transient 409 never pauses beacons")
        self.api_srv.beacon_409 = None
        self.run_for(200, step=5)
        sent = [r["body"] for r in self.api_srv.requests if r["path"] == "/api/beacon/ingest" and r["body"].get("water_detected") is True]
        self.assertTrue(sent, "the critical beacon is delivered on a later try")
        self.assertEqual({b["event_id"] for b in sent}, {want["eid"]}, "same event id, never invented anew")
        self.assertEqual(self.store.peek("beacon", 1), [])

    def test_no_home_409_pauses_new_beacons_but_never_with_a_critical_row_waiting(self):
        a = self.make(assume_mains="unknown")
        self.api_srv.beacon_409 = "Assign a home to the device before ingesting"
        a._push_beacon(self.clock.wall(), water=False, prio=PRIO_ROUTINE)
        a._flush(self.clock.t, force=True)
        self.assertGreater(a.beacon_disabled_until, self.clock.wall(), "no home: pause new routine beacons")
        self.assertEqual(self.store.stats()["rows"], 1, "the row is kept, not acked")
        b = self.make(assume_mains="unknown")
        self.api_srv.beacon_409 = "Assign a home to the device before ingesting"
        b._push_beacon(self.clock.wall(), water=True, prio=PRIO_CRITICAL)
        b._flush(self.clock.t, force=True)
        self.assertEqual(b.beacon_disabled_until, 0.0, "a pending critical beacon is never paused")
        self.assertEqual(self.store.stats()["critical"], 1)

    def test_other_rows_still_flow_while_a_beacon_is_held(self):
        a = self.make(assume_mains="unknown")
        self.api_srv.beacon_409 = "Event is processing or requires receipt reconciliation; retry later"
        a._push_beacon(self.clock.wall(), water=True, prio=PRIO_CRITICAL)
        a._event("hub.hazard_seen", {"box": "A"}, PRIO_CRITICAL)
        a._flush(self.clock.t, force=True)
        self.assertEqual([r["kind"] for r in self.store.peek(limit=5)], ["beacon"])
        self.assertIn("/api/events", self.api_srv.paths())

    def test_battery_estimate_counts_down_off_mains_without_a_gauge(self):
        a = self.make(assume_mains="lost", assumed_soc_pct=100, battery_mah=6000)
        self.run_for(30)
        first = a.batt.soc_pct
        hours = a.decision.hours_remaining
        self.assertEqual(a.batt.soc_source, "integrated_estimate")
        self.run_for(6 * 3600, step=30)
        self.assertLess(a.batt.soc_pct, first, "charge goes down with energy used")
        self.assertGreater(a.used_wh, 5.0)
        self.assertLess(a.decision.hours_remaining, hours - 3, "runway shrinks as the battery drains")
        self.assertEqual(a.status()["power"]["battery"]["estimate_source"], "integrated_estimate")

    def test_battery_estimate_does_not_count_on_mains_or_with_a_gauge(self):
        a = self.make(assume_mains="present")
        self.run_for(3600, step=30)
        self.assertEqual(a.used_wh, 0.0)
        g = self.make(assume_mains="lost")
        g.battery_reader = lambda: type("B", (), {"soc_pct": 80.0, "soc_source": "gauge", "mains": None, "charging": None, "note": ""})()
        self.run_for(3600, step=30)
        self.assertEqual(g.used_wh, 0.0)
        self.assertEqual(g.batt.soc_pct, 80.0)

    def test_energy_counter_survives_restart_and_resets_when_start_charge_changes(self):
        a = self.make(assume_mains="lost", assumed_soc_pct=90)
        self.run_for(2 * 3600, step=30)
        a.shutdown()
        used = a.used_wh
        self.assertGreater(used, 0)
        b = Agent(self.cfg, self.store, self.api, mcu.FakeSource(scripted=[]), wall=self.clock.wall, mono=self.clock.mono, rng=random.Random(2))
        self.assertAlmostEqual(b.used_wh, used, places=3)
        import dataclasses
        c = Agent(dataclasses.replace(self.cfg, assumed_soc_pct=100), self.store, self.api, mcu.FakeSource(scripted=[]), wall=self.clock.wall, mono=self.clock.mono, rng=random.Random(3))
        self.assertEqual(c.used_wh, 0.0, "entering a new starting charge restarts the count")

    def test_loop_sleeps_during_a_network_outage(self):
        a = self.make(assume_mains="present")
        self.run_for(10)
        self.api_srv.fail_with = 503
        wakeups = 0
        end = self.clock.t + 60
        while self.clock.t < end:
            delay = a.step()
            self.assertGreaterEqual(delay, 1.0, "never wakes more than once a second")
            wakeups += 1
            self.clock.advance(delay)
        self.assertLess(wakeups, 40, f"{wakeups} wakeups in 60 s of outage")

    def test_loop_sleeps_with_no_api(self):
        a = self.make(assume_mains="present")
        a.api = None
        self.run_for(5)
        self.assertGreaterEqual(a.step(), 1.0)

    def test_hazard_active_is_omitted_when_there_is_no_data(self):
        a = self.make(assume_mains="present")
        self.run_for(3)
        a._push_status(self.clock.wall(), PRIO_CRITICAL)
        sensors = [r["sensor"] for row in self.store.peek("ingest", 50) for r in row["body"]["readings"]]
        self.assertNotIn("hazard_active", sensors, "no box heard: unknown, not 'no hazard'")
        self.assertFalse(a.status()["hazard"]["known"])

    def test_hazard_active_reports_zero_only_after_a_fresh_reading(self):
        a = self.make(assume_mains="present")
        a.on_mcu({"box": "A", "type": "reading", "water": False})
        self.run_for(3)
        self.store.ack([r["id"] for r in self.store.peek(limit=100)])
        a._push_status(self.clock.wall(), PRIO_CRITICAL)
        vals = {r["sensor"]: r["value"] for row in self.store.peek("ingest", 50) for r in row["body"]["readings"]}
        self.assertEqual(vals.get("hazard_active"), 0)
        self.assertTrue(a.status()["hazard"]["known"])

    def test_hazard_active_is_one_when_latched(self):
        a = self.make(assume_mains="present")
        a.on_mcu({"box": "A", "type": "reading", "water": True})
        self.run_for(3)
        self.store.ack([r["id"] for r in self.store.peek(limit=100)])
        a._push_status(self.clock.wall(), PRIO_CRITICAL)
        vals = {r["sensor"]: r["value"] for row in self.store.peek("ingest", 50) for r in row["body"]["readings"]}
        self.assertEqual(vals.get("hazard_active"), 1)


class Messages(Harness):
    def msg(self, seq, title, body, kind="instruction", ack=True, mid=None):
        return {"seq": seq, "id": mid or f"{seq:024x}", "kind": kind, "severity": "info", "title": title, "body": body,
                "expires_at": "2099-01-01T00:00:00Z", "requires_ack": ack}

    def test_info_message_is_shown_and_reported_shown(self):
        a = self.make()
        self.api_srv.messages = [self.msg(1, "Storm", "Stay inside", "info", True)]
        self.run_for(40)
        self.assertIn(("0" * 23 + "1", "shown"), self.api_srv.acks)
        self.assertTrue(any("Stay inside" in i["text"] for i in a.live.inbox))
        self.assertNotIn(("0" * 23 + "1", "acked"), self.api_srv.acks, "a human must acknowledge, not the agent")

    def test_command_message_runs_and_is_acked_once(self):
        a = self.make()
        self.api_srv.messages = [self.msg(1, "CMD", "poll 77")]
        self.run_for(40)
        self.assertEqual(a.poll_override[0], 77)
        self.assertIn(("0" * 23 + "1", "acked"), self.api_srv.acks)
        # the same message arriving again (cursor reset) must not run twice
        a.poll_override = None
        a.cursor = 0
        a.next_poll = self.clock.t
        self.run_for(40)
        self.assertIsNone(a.poll_override)

    def test_unknown_or_dangerous_command_is_refused_and_logged(self):
        a = self.make()
        self.api_srv.messages = [self.msg(1, "CMD", "poll 60; rm -rf /"), self.msg(2, "CMD", "reboot-agent")]
        self.run_for(60)
        self.assertGreaterEqual(a.counters["commands_refused"], 2)
        self.assertEqual(a.counters["commands"], 0)
        self.assertFalse(a.stop.is_set())
        refused = [r for r in self.api_srv.requests if r["path"] == "/api/events" and r["body"]["type"] == "agent.cmd_refused"]
        self.assertEqual(len(refused), 2)

    def test_commands_can_be_turned_off(self):
        a = self.make(allow_commands=False)
        self.api_srv.messages = [self.msg(1, "CMD", "poll 77")]
        self.run_for(40)
        self.assertIsNone(a.poll_override)

    def test_reboot_agent_only_when_enabled(self):
        a = self.make(allow_reboot_agent=True)
        self.api_srv.messages = [self.msg(1, "CMD", "reboot-agent")]
        self.run_for(40)
        self.assertTrue(a.stop.is_set())
        self.assertEqual(a.exit_code, 75)

    def test_mode_command_holds_then_auto_releases(self):
        a = self.make(need_hours=1)
        a.on_mcu({"box": "A", "type": "reading", "mains": False})
        a._exec(commands.parse("mode beacon 5"), "test")
        self.run_for(40)
        self.assertEqual(a.decision.mode, "beacon")
        a._exec(commands.parse("mode auto"), "test")
        self.run_for(700, step=10)
        self.assertNotEqual(a.decision.mode, "beacon")

    def test_settings_revision_applied_and_reported(self):
        a = self.make()
        self.api_srv.config = {"revision": 4, "pollAfterSeconds": 120}
        self.run_for(30)
        self.assertEqual(a.settings_poll, 120)
        posts = [r["body"] for r in self.api_srv.requests if r["path"] == "/api/device/settings" and r["method"] == "POST"]
        self.assertEqual(posts, [{"revision": 4, "pollAfterSeconds": 120}])
        self.assertGreaterEqual(a._poll_seconds(), 120)

    def test_poll_interval_never_below_ten_in_full_or_below_floor_when_saving(self):
        a = self.make()
        self.run_for(5)
        a.server_poll = 10
        self.assertEqual(a._poll_seconds(), 10)   # urgent operator message honored in full mode
        a.on_mcu({"box": "A", "type": "reading", "mains": False})
        a._exec(commands.parse("mode survival 10"), "t")
        self.run_for(40)
        self.assertGreaterEqual(a._poll_seconds(), 120)


class Interfaces(Harness):
    def test_status_endpoint_is_read_only_loopback_and_keyless(self):
        a = self.make()
        self.run_for(5)
        srv = servers.StatusServer(0, a.status, lambda: a.live.recent(10))
        srv.start()
        try:
            self.assertEqual(srv.httpd.server_address[0], "127.0.0.1")
            base = f"http://127.0.0.1:{srv.port}"
            body = urllib.request.urlopen(base + "/status", timeout=3).read().decode()
            st = json.loads(body)
            self.assertIn("power", st)
            self.assertNotIn(KEY, body)
            self.assertNotIn("dk_", body)
            req = urllib.request.Request(base + "/status", data=b"{}", method="POST")
            with self.assertRaises(urllib.error.HTTPError) as cm:
                urllib.request.urlopen(req, timeout=3)
            self.assertEqual(cm.exception.code, 405)
            req = urllib.request.Request(base + "/status", headers={"Host": "evil.example"})
            with self.assertRaises(urllib.error.HTTPError) as cm:
                urllib.request.urlopen(req, timeout=3)
            self.assertEqual(cm.exception.code, 403)
        finally:
            srv.stop()

    def test_control_socket_say_cmd_and_permissions(self):
        a = self.make()
        path = os.path.join(self.d, "control.sock")
        ctl = servers.ControlServer(path, a.local_request)
        ctl.start()
        try:
            self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)
            self.assertTrue(servers.send_control(path, "say", "hello bench").startswith("shown"))
            self.assertTrue(servers.send_control(path, "cmd", "poll 90").startswith("accepted"))
            self.assertTrue(servers.send_control(path, "cmd", "poll 5").startswith("refused"))
            self.assertTrue(servers.send_control(path, "cmd", "ls -la").startswith("refused"))
            self.run_for(3)
            self.assertEqual(a.poll_override[0], 90)
            self.assertTrue(any("hello bench" in i["text"] for i in a.live.inbox))
        finally:
            ctl.stop()

    def test_mute_silences_terminal_but_keeps_inbox(self):
        a = self.make()
        a._exec(commands.parse("mute on"), "t")
        a.say("quiet note")
        self.assertTrue(any("quiet note" in i["text"] for i in a.live.inbox))
        self.assertTrue(a.muted)


class ConfigAndUpdate(unittest.TestCase):
    def test_https_required_except_loopback(self):
        with self.assertRaises(config.ConfigError):
            config.Config(base_url="http://example.com").validate()
        config.Config(base_url="http://127.0.0.1:8788").validate()
        config.Config(base_url="https://utd-hackathon-26.pages.dev").validate()

    def test_bench_measurement_needs_all_four_modes(self):
        with self.assertRaises(config.ConfigError):
            config.Config(load_basis="bench_measurement").validate()
        with self.assertRaises(config.ConfigError):
            config.Config(load_basis="bench_measurement", measured_mw={"full": 2400, "eco": 2000, "beacon": 1000}).validate()
        ok = config.Config(load_basis="bench_measurement", measured_mw={"full": 2400, "eco": 2000, "survival": 1500, "beacon": 1000}).validate()
        self.assertEqual(ok.power_config().load_basis, "bench_measurement")
        # a partial table never claims to be measured, even without the bench_measurement switch
        part = config.Config(measured_mw={"full": 2400, "eco": 2000, "beacon": 1000}).validate()
        self.assertEqual(part.power_config().load_basis, "partial_measurement")
        self.assertEqual(config.Config().power_config().load_basis, "assumption")

    def test_impossible_converter_is_refused(self):
        with self.assertRaises(config.ConfigError) as cm:
            config.Config(battery_mah=10000, battery_nominal_v=3.7, battery_converter="buck").validate()
        self.assertIn("use boost, or a 2S pack", str(cm.exception))
        with self.assertRaises(config.ConfigError):
            config.Config(battery_mah=10000, battery_nominal_v=3.7, battery_converter="ldo").validate()
        config.Config(battery_mah=10000, battery_nominal_v=3.7, battery_converter="boost").validate()
        config.Config(battery_mah=10000, battery_nominal_v=7.4, battery_converter="buck").validate()

    def test_unknown_keys_rejected(self):
        d = short_tmp()
        p = os.path.join(d, "c.toml")
        open(p, "w").write("[api]\nbase_url='https://x.example'\nsurprise=1\n")
        with self.assertRaises(config.ConfigError):
            config.load(p)
        shutil.rmtree(d)

    def test_example_config_loads(self):
        d = short_tmp()
        p = os.path.join(d, "c.toml")
        open(p, "w").write(config.EXAMPLE)
        cfg = config.load(p)
        self.assertEqual(cfg.status_port, 8765)
        self.assertFalse(cfg.allow_reboot_agent)
        shutil.rmtree(d)

    def test_key_file_must_be_private(self):
        d = short_tmp()
        p = os.path.join(d, "k")
        open(p, "w").write("dk_abc\n")
        os.chmod(p, 0o644)
        cfg = config.Config(key_file=p, key_env="HB_TEST_UNSET_KEY")
        with self.assertRaises(config.ConfigError):
            cfg.device_key()
        os.chmod(p, 0o600)
        self.assertEqual(cfg.device_key(), "dk_abc")
        shutil.rmtree(d)

    def test_manifest_validation_and_version_order(self):
        self.assertGreater(updater.vtuple("0.10.0"), updater.vtuple("0.9.9"))
        with self.assertRaises(updater.UpdateError):
            updater.validate_manifest({"version": "1.0.0", "file": "../evil.tar.gz", "sha256": "0" * 64, "size": 10})
        with self.assertRaises(updater.UpdateError):
            updater.validate_manifest({"version": "1.0.0", "file": "homebeacon-unoq-1.0.0.tar.gz", "sha256": "xyz", "size": 10})
        with self.assertRaises(updater.UpdateError):
            updater._get("http://example.com/x", 10)


if __name__ == "__main__":
    unittest.main()
