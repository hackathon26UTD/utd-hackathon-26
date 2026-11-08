import re
import unittest
from pathlib import Path

from hbagent import power
from hbagent.power import Battery, LadderState, PowerConfig, PowerInputs, decide, plan

REPO = Path(__file__).resolve().parents[3]
LIION = Battery(6000, 7.4, 100, "gauge", "liion", 0.88)


class Mirror(unittest.TestCase):
    """The hub's full/eco/hazard constants must match the firmware header and the server policy."""

    def test_matches_firmware_header_and_server_policy(self):
        h = (REPO / "firmware/common/power_policy.h").read_text()
        normal = re.search(r"Normal, (\d+), (\d+), (\d+)", h).groups()
        saver = re.search(r"Saver, (\d+), (\d+), (\d+)", h).groups()
        crit = re.search(r"Critical, (\d+), (\d+), (\d+)", h).groups()
        p = power.DEFAULT_PROFILES
        self.assertEqual(int(normal[1]) // 1000, p["full"].report_s)
        self.assertEqual(int(normal[2]) // 1000, p["full"].wifi_retry_s)
        self.assertEqual(int(saver[1]) // 1000, p["eco"].report_s)
        self.assertEqual(int(saver[2]) // 1000, p["eco"].wifi_retry_s)
        self.assertEqual(int(crit[1]) // 1000, power.HAZARD_REPORT_S)
        self.assertEqual(int(crit[2]) // 1000, power.HAZARD_WIFI_RETRY_S)
        js = (REPO / "domain/system-policy.js").read_text()
        self.assertIn("reportMs: 120_000", js)
        self.assertIn("FRESH_MS = 120_000", js)
        self.assertEqual(power.FRESH_S, 120)
        self.assertEqual(PowerConfig().reserve_fraction, 0.15)

    def test_server_mode_vocabulary(self):
        self.assertEqual(power.SERVER_MODE["full"], "normal")
        self.assertEqual(power.SERVER_MODE["eco"], "saver")


class Estimator(unittest.TestCase):
    def test_load_falls_with_each_mode(self):
        loads = [power.avg_load_mw(power.DEFAULT_PROFILES[m]) for m in power.MODES]
        self.assertEqual(loads, sorted(loads, reverse=True))

    def test_hours_follow_formula(self):
        cfg = PowerConfig()
        want = power.available_wh(LIION, cfg) * 1000 / power.avg_load_mw(cfg.profiles["full"])
        self.assertAlmostEqual(power.hours_at(LIION, cfg, "full"), want)

    def test_reserve_is_larger_of_fraction_and_last_gasp(self):
        small = Battery(1000, 3.7, 100, "gauge", "liion", 0.9)
        self.assertAlmostEqual(power.reserve_wh(small, PowerConfig()), power.last_gasp_wh(PowerConfig()))
        big = Battery(100000, 3.7, 100, "gauge", "liion", 0.9)
        self.assertAlmostEqual(power.reserve_wh(big, PowerConfig()), big.usable_wh() * 0.15)

    def test_ldo_wastes_energy(self):
        self.assertAlmostEqual(power.converter_efficiency("ldo", 9.0), 5 / 9)
        self.assertGreater(power.converter_efficiency("buck", 9.0), power.converter_efficiency("ldo", 9.0))

    def test_voltage_estimate_caps_confidence_low(self):
        b = Battery(6000, 7.4, 50, "voltage_estimate", "liion", 0.88)
        conf, _ = power.confidence(b, PowerConfig(load_basis="bench_measurement"))
        self.assertEqual(conf, "low")

    def test_confidence_grades(self):
        self.assertEqual(power.confidence(LIION, PowerConfig())[0], "medium")
        self.assertEqual(power.confidence(LIION, PowerConfig(load_basis="bench_measurement"))[0], "high")
        self.assertEqual(power.confidence(None, PowerConfig())[0], "none")

    def test_measured_loads_replace_estimates(self):
        cfg = PowerConfig().with_measured({"full": 3000, "eco": 2400, "survival": 1800, "beacon": 1400})
        self.assertAlmostEqual(power.avg_load_mw(cfg.profiles["full"]), 3000, places=3)
        self.assertEqual(cfg.load_basis, "bench_measurement")

    def test_partial_measurement_is_not_labelled_measured(self):
        cfg = PowerConfig().with_measured({"full": 3000, "eco": 2400, "beacon": 1400})   # survival missing
        self.assertEqual(cfg.load_basis, "partial_measurement")
        conf, notes = power.confidence(LIION, cfg)    # LIION has a gauge, which would otherwise make it high
        self.assertEqual(conf, "medium")
        self.assertTrue(any("Only some modes" in n for n in notes))
        self.assertEqual(PowerConfig().with_measured({"full": 3000}).load_basis, "partial_measurement")

    def test_buck_and_ldo_cannot_make_5v_from_one_cell(self):
        self.assertIn("use boost, or a 2S pack", power.converter_problem("buck", 3.7))
        self.assertIsNotNone(power.converter_problem("ldo", 5.0))
        self.assertIsNone(power.converter_problem("boost", 3.7))
        self.assertIsNone(power.converter_problem("buck", 7.4))
        self.assertIsNone(power.converter_problem("buck", 0))      # unknown pack: nothing to judge

    def test_soc_from_voltage_monotonic(self):
        vs = [3.0, 3.4, 3.7, 3.9, 4.2]
        socs = [power.soc_from_voltage("liion", v) for v in vs]
        self.assertEqual(socs, sorted(socs))
        self.assertIsNone(power.soc_from_voltage("unknown", 3.7))


class Ladder(unittest.TestCase):
    def test_mains_present_is_full(self):
        d = plan(LIION, PowerConfig(), "present")
        self.assertEqual(d.mode, "full")
        self.assertEqual(d.server_mode, "normal")

    def test_unknown_mains_is_treated_as_lost(self):
        d = plan(LIION, PowerConfig(need_hours=40), "unknown")
        self.assertNotEqual(d.mode, "full")
        self.assertIn("treated as lost", d.summary())

    def test_big_battery_stays_high_small_one_drops(self):
        big = Battery(50000, 7.4, 100, "gauge", "liion", 0.88)
        self.assertEqual(plan(big, PowerConfig(need_hours=24), "lost").mode, "full")
        small = Battery(3000, 3.7, 100, "gauge", "liion", 0.88)
        self.assertEqual(plan(small, PowerConfig(need_hours=24), "lost").mode, "beacon")

    def test_picks_highest_mode_that_meets_target(self):
        cfg = PowerConfig(need_hours=14)
        d = plan(LIION, cfg, "lost")
        self.assertTrue(d.meets_target)
        for row in d.table:
            if power.RANK[row["mode"]] > power.RANK[d.mode]:
                self.assertFalse(row["meets_target"])

    def test_shortfall_is_stated_in_plain_words(self):
        d = plan(Battery(1000, 3.7, 100, "gauge", "liion", 0.88), PowerConfig(need_hours=24), "lost")
        self.assertFalse(d.meets_target)
        self.assertIn("short by about", d.summary())
        self.assertIn("Wh of extra", d.summary())

    def test_empty_battery_goes_last_gasp(self):
        d = plan(Battery(2000, 3.7, 3, "gauge", "liion", 0.88), PowerConfig(), "lost")
        self.assertEqual(d.mode, "beacon")
        self.assertTrue(d.last_gasp_active)

    def test_no_battery_info_means_no_promise(self):
        d = plan(None, PowerConfig(), "lost")
        self.assertEqual(d.mode, "eco")
        self.assertIsNone(d.hours_remaining)
        self.assertEqual(d.confidence, "none")
        self.assertEqual(plan(None, PowerConfig(), "lost", True).mode, "full")

    def test_hazard_boost_only_with_runway(self):
        cfg = PowerConfig(need_hours=24)
        rich = Battery(12000, 7.4, 100, "gauge", "liion", 0.88)
        d = plan(rich, cfg, "lost", hazard=True)
        self.assertTrue(d.hazard_boost)
        self.assertEqual(d.report_s, power.HAZARD_REPORT_S)
        self.assertEqual(d.server_mode, "critical")
        poor = Battery(1500, 3.7, 100, "gauge", "liion", 0.88)
        d2 = plan(poor, cfg, "lost", hazard=True)
        self.assertFalse(d2.hazard_boost)
        self.assertIn("drain the battery too fast", d2.summary())

    def test_hazard_at_last_gasp_keeps_only_beacon(self):
        d = plan(Battery(2000, 3.7, 3, "gauge", "liion", 0.88), PowerConfig(), "lost", hazard=True)
        self.assertEqual(d.mode, "beacon")
        self.assertFalse(d.hazard_boost)

    def test_hysteresis_blocks_quick_step_up(self):
        cfg = PowerConfig(need_hours=8)
        st = LadderState("eco", 1000.0)
        d, st2 = decide(PowerInputs(LIION, "lost"), st, 1100.0, cfg)   # 100 s later
        self.assertEqual(d.mode, "eco")
        self.assertIn("does not flap", d.summary())
        self.assertGreaterEqual(power.hours_at(LIION, cfg, "full"), 8 * 1.2)
        d3, _ = decide(PowerInputs(LIION, "lost"), st, 1000.0 + cfg.up_dwell_s + 1, cfg)
        self.assertNotEqual(d3.mode, "eco")

    def test_step_down_is_prompt_when_current_mode_cannot_meet_need(self):
        cfg = PowerConfig(need_hours=24)
        weak = Battery(3000, 3.7, 100, "gauge", "liion", 0.88)
        d, _ = decide(PowerInputs(weak, "lost"), LadderState("full", 100.0), 101.0, cfg)
        self.assertEqual(d.mode, "beacon")

    def test_mains_return_steps_up_after_short_dwell(self):
        d, _ = decide(PowerInputs(LIION, "present"), LadderState("beacon", 0.0), 5.0, PowerConfig())
        self.assertEqual(d.mode, "beacon")
        d, _ = decide(PowerInputs(LIION, "present"), LadderState("beacon", 0.0), 31.0, PowerConfig())
        self.assertEqual(d.mode, "full")

    def test_override_lower_always_ok_higher_needs_runway(self):
        d, _ = decide(PowerInputs(LIION, "lost", False, "beacon", True), LadderState(), 0, PowerConfig(need_hours=1))
        self.assertEqual(d.mode, "beacon")
        tiny = Battery(2200, 3.7, 40, "gauge", "liion", 0.88)
        d, _ = decide(PowerInputs(tiny, "lost", False, "full", True), LadderState(), 0, PowerConfig())
        self.assertNotEqual(d.mode, "full")
        self.assertIn("was refused", d.summary())

    def test_decision_has_plain_sentences_and_assumptions(self):
        d = plan(LIION, PowerConfig(), "lost")
        self.assertTrue(all(r.endswith(".") for r in d.reasons))
        self.assertNotIn("\u2014", d.summary())
        self.assertTrue(d.assumptions)


if __name__ == "__main__":
    unittest.main()
