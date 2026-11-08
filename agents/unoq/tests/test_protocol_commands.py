import unittest

from hbagent import commands, protocol
from hbagent.protocol import LiveState


class Parse(unittest.TestCase):
    def test_hb_lines(self):
        self.assertEqual(protocol.parse_hb_line('HB {"box":"B","type":"event","event":"flame.detected"}')["event"], "flame.detected")
        self.assertIsNone(protocol.parse_hb_line("[wifi] connecting"))
        self.assertIsNone(protocol.parse_hb_line('HB {"box":"bad id!"}'))
        self.assertIsNone(protocol.parse_hb_line("HB {broken"))
        self.assertIsNone(protocol.parse_hb_line("HB " + "x" * 5000))

    def test_hazards(self):
        self.assertEqual(protocol.hazards_in({"box": "A", "water": True}), ["water"])
        self.assertEqual(protocol.hazards_in({"box": "A", "water": False, "flame": False}), [])
        self.assertIn("event:flame.detected", protocol.hazards_in({"box": "A", "type": "event", "event": "flame.detected"}))
        self.assertEqual(protocol.hazards_in({"box": "A", "type": "event", "event": "help.request"}), [])
        self.assertIn("high_temp", protocol.hazards_in({"box": "A", "temp_c": 56}))
        self.assertIn("sound_alarm", protocol.hazards_in({"box": "A", "sound_hits": 6}))


class Live(unittest.TestCase):
    def test_hazard_does_not_turn_safe_with_time(self):
        s = LiveState()
        s.ingest({"box": "A", "type": "reading", "water": True}, 0.0)
        self.assertTrue(s.hazard(10.0)[0])
        self.assertTrue(s.hazard(5000.0)[0], "old evidence must stay a hazard until a newer reading says otherwise")

    def test_hazard_clears_only_after_fresh_false_and_hold(self):
        s = LiveState()
        s.ingest({"box": "A", "type": "reading", "water": True}, 0.0)
        s.ingest({"box": "A", "type": "reading", "water": False}, 100.0)
        self.assertTrue(s.hazard(200.0)[0], "held for the minimum time")
        self.assertFalse(s.hazard(protocol.HAZARD_HOLD_S + 1)[0])

    def test_mains_unknown_when_stale_or_missing(self):
        s = LiveState()
        self.assertEqual(s.mains(0), "unknown")
        s.ingest({"box": "A", "type": "reading", "mains": True}, 10.0)
        self.assertEqual(s.mains(20.0), "present")
        self.assertEqual(s.mains(10.0 + protocol.FRESH_S + 1), "unknown")
        s.ingest({"box": "A", "type": "reading", "mains": False}, 30.0)
        self.assertEqual(s.mains(31.0), "lost")

    def test_view_marks_stale_unknown(self):
        s = LiveState()
        s.ingest({"box": "A", "type": "reading", "water": False}, 0.0)
        v = s.view(500.0)["boxes"]["A"]
        self.assertIn("unknown", v["state"])
        self.assertIn("not safe", v["state"])

    def test_ring_and_inbox_bounded(self):
        s = LiveState(ring_size=5, inbox_size=3)
        for i in range(20):
            s.ingest({"box": "A", "type": "reading", "seq": i}, float(i))
            s.inbox.append(i)
        self.assertEqual(len(s.recent(100)), 5)
        self.assertEqual(len(s.inbox), 3)


class HazardClears(unittest.TestCase):
    def test_high_temp_and_sound_clear_on_a_fresh_low_reading(self):
        st = LiveState()
        st.ingest({"box": "A", "type": "reading", "temp_c": 70, "sound_hits": 9}, 0.0)
        self.assertEqual(st.hazard(1.0)[1], ["A:high_temp", "A:sound_alarm"])
        st.ingest({"box": "A", "type": "reading", "temp_c": 30, "sound_hits": 1}, 100.0)
        self.assertTrue(st.hazard(300.0)[0], "held for the minimum time first")
        self.assertEqual(st.hazard(700.0), (False, []))

    def test_high_temp_does_not_clear_with_only_time(self):
        st = LiveState()
        st.ingest({"box": "A", "type": "reading", "temp_c": 70}, 0.0)
        self.assertTrue(st.hazard(5000.0)[0], "no newer reading, so it stays")

    def test_still_hot_reading_keeps_it(self):
        st = LiveState()
        st.ingest({"box": "A", "type": "reading", "temp_c": 70}, 0.0)
        st.ingest({"box": "A", "type": "reading", "temp_c": 60}, 650.0)
        self.assertTrue(st.hazard(700.0)[0])

    def test_event_reason_expires_only_when_the_box_is_still_heard(self):
        st = LiveState()
        st.ingest({"box": "A", "type": "event", "event": "quake"}, 0.0)
        self.assertEqual(st.hazard(10.0)[1], ["A:event:quake"])
        self.assertTrue(st.hazard(5000.0)[0], "a silent box never turns safe by the clock")
        st.ingest({"box": "A", "type": "reading", "mains": True}, 5000.0)
        self.assertEqual(st.hazard(5010.0), (False, []))
        # a repeat of the event inside the hold keeps it
        st2 = LiveState()
        st2.ingest({"box": "A", "type": "event", "event": "quake"}, 0.0)
        st2.ingest({"box": "A", "type": "event", "event": "quake"}, 500.0)
        st2.ingest({"box": "A", "type": "reading", "mains": True}, 650.0)
        self.assertTrue(st2.hazard(700.0)[0])

    def test_fresh_any_needs_a_recent_box(self):
        st = LiveState()
        self.assertFalse(st.fresh_any(0.0))
        st.ingest({"box": "A", "type": "reading", "mains": True}, 10.0)
        self.assertTrue(st.fresh_any(100.0))
        self.assertFalse(st.fresh_any(500.0))


class Payloads(unittest.TestCase):
    def test_beacon_payload_rules(self):
        self.assertIsNone(protocol.beacon_payload("a" * 24, "e1", 1, 1e9))
        b = protocol.beacon_payload("a" * 24, "e1", 1, 1_800_000_000, mains=True, battery_pct=83.26)
        self.assertEqual(b["main_power_available"], True)
        self.assertEqual(b["battery_pct"], 83.3)
        self.assertTrue(b["observed_at"].endswith("Z"))
        old = protocol.beacon_payload("a" * 24, "e1", 1, 100, mains=False)
        self.assertNotIn("observed_at", old, "an untrusted clock is omitted so the server marks the fallback")
        self.assertIsNone(protocol.beacon_payload("a" * 24, "e1", 1, 1e9, battery_pct=140))

    def test_event_ids_unique_across_boots(self):
        a = protocol.Sequencer("d", 1).next()[0]
        b = protocol.Sequencer("d", 2).next()[0]
        self.assertNotEqual(a, b)
        self.assertRegex(a, r"^[A-Za-z0-9_.:-]{1,100}$")


class Commands(unittest.TestCase):
    def test_valid(self):
        self.assertEqual(commands.parse("poll 60").args, (60,))
        self.assertEqual(commands.parse("MODE eco 30").args, ("eco", 30))
        self.assertEqual(commands.parse("mode auto").args, ("auto", 60))
        self.assertEqual(commands.parse("identify").args, (5,))
        self.assertEqual(commands.parse("mute on").args, ("on",))
        self.assertEqual(commands.parse("status").name, "status")

    def test_bounds(self):
        for bad in ("poll 9", "poll 301", "poll abc", "poll", "poll 60 70", "identify 31", "mode turbo", "mode eco 241", "mute maybe", "status now"):
            with self.assertRaises(commands.CommandError, msg=bad):
                commands.parse(bad)

    def test_never_a_shell(self):
        for bad in ("poll 60; ls", "status && reboot", "$(id)", "cat /etc/passwd", "bash -c x", "poll `id`", "sh", "rm -rf /", "status | nc"):
            with self.assertRaises(commands.CommandError, msg=bad):
                commands.parse(bad)

    def test_reboot_is_off_by_default(self):
        with self.assertRaises(commands.CommandError):
            commands.parse("reboot-agent")
        self.assertEqual(commands.parse("reboot-agent", allow_reboot=True).name, "reboot-agent")

    def test_from_message(self):
        self.assertTrue(commands.is_command_message("CMD"))
        self.assertTrue(commands.is_command_message("cmd poll 60"))
        self.assertFalse(commands.is_command_message("Storm warning"))
        self.assertEqual(commands.from_message("CMD", "poll 45").args, (45,))
        self.assertEqual(commands.from_message("CMD poll 45", "").args, (45,))

    def test_every_allowlisted_command_fits_the_message_limits(self):
        for name, (usage, _) in commands.ALLOWLIST.items():
            self.assertLessEqual(len(name), 20)


if __name__ == "__main__":
    unittest.main()
