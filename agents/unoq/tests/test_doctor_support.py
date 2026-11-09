import contextlib
import gzip
import io
import json
import os
import shutil
import ssl
import stat
import tarfile
import tempfile
import time
import unittest
from unittest import mock

from hbagent import cli, config, doctor, support, updater
from hbagent.store import PRIO_CRITICAL, PRIO_ROUTINE, Store
from hbagent.uplink import Result

KEY = "dk_" + "Zq7" * 8          # fake, test only
DEV = "c" * 24
NOW = 1_800_000_000.0


def http_date(ts):
    import email.utils
    return email.utils.formatdate(ts, usegmt=True)


class Base(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp(prefix="hbd", dir=("/tmp" if os.path.isdir("/tmp") else None))
        self.state = os.path.join(self.d, "state")
        os.makedirs(self.state, mode=0o700)
        self.env_file = os.path.join(self.d, "unoq.env")
        self.write_env(0o600)
        self.cfg = config.Config(base_url="https://api.example.test", device_id=DEV, state_dir=self.state, mcu_source="none",
                                 status_port=8765, key_env="HB_TEST_NO_SUCH_VAR").validate()
        self.cfg_path = os.path.join(self.d, "unoq.toml")
        open(self.cfg_path, "w").write(f'[api]\nbase_url = "https://api.example.test"\ndevice_id = "{DEV}"\n[agent]\nstate_dir = "{self.state}"\n[mcu]\nsource = "none"\n[status]\nport = 0\n')
        os.chmod(self.cfg_path, 0o644)

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def write_env(self, mode):
        with open(self.env_file, "w") as f:
            f.write(f"HB_DEVICE_KEY={KEY}\n")
        os.chmod(self.env_file, mode)

    def probes(self, **over):
        sysd = {("systemctl", "is-active"): (0, "active"), ("systemctl", "is-enabled"): (0, "enabled"),
                ("timedatectl", "show"): (0, "yes"), ("systemctl", "show"): (0, "0")}

        def run(cmd, timeout=5.0):
            return sysd.get((cmd[0], cmd[1]), (127, ""))

        base = dict(
            now=lambda: NOW,
            resolve=lambda h, timeout=5.0: ["203.0.113.5"],
            tls=lambda h, p, timeout=6.0: {"version": "TLSv1.3", "days_left": 60},
            http_get=lambda url, headers=None, timeout=8.0: (200, {"Date": http_date(NOW)}, b'{"status":"ready"}'),
            run=run,
            local_status=lambda port: {"mcu": {"connected": True, "error": ""}, "uplink": {"last_ok_age_s": 40, "auth_failed": False},
                                       "live": {"boxes": {"A": {"age_s": 12.0}}}},
            api_settings=lambda: Result(200, {"configuration": None}),
        )
        base.update(over)
        return doctor.Probes(**base)

    def run_doctor(self, cfg=None, **kw):
        kw.setdefault("config_path", self.cfg_path)
        kw.setdefault("env_file", self.env_file)
        kw.setdefault("update_status", {"current": "1.0.0", "latest": "1.0.0"})
        kw.setdefault("uplink_state", {"state": "closed", "key_rejected": False, "last_ok_wall": NOW - 40})
        kw.setdefault("queue_path", os.path.join(self.d, "none.sqlite"))
        kw.setdefault("probes", self.probes())
        return {c.name: c for c in doctor.run_checks(cfg or self.cfg, **kw)}


class MaskTests(unittest.TestCase):
    def test_masks_device_keys_headers_bearer_urls_and_long_tokens(self):
        cases = [
            f"sent X-Device-Key: {KEY} ok",
            f"Authorization: Bearer abcdefghijklmnop1234 end",
            "https://user:hunter2@host.example/path",
            "HB_DEVICE_KEY=abcd1234efgh5678",
            "token=0123456789abcdef0123456789abcdef0123",
            "blob QWxhZGRpbjpvcGVuIHNlc2FtZVRoaXNJc0xvbmdlclRoYW5Gb3J0eUNoYXJz end",
            f"raw {KEY} inline",
        ]
        for text in cases:
            out = support.mask(text)
            for needle in (KEY, "abcdefghijklmnop1234", "hunter2", "abcd1234efgh5678", "0123456789abcdef0123456789abcdef0123", "QWxhZGRpbjpvcGVu"):
                self.assertNotIn(needle, out, text)

    def test_keeps_harmless_context(self):
        t = f"device {DEV} key_file=/etc/homebeacon/unoq.key sha256 {'a1' * 32} /opt/homebeacon-unoq/releases/1.2.3/current"
        out = support.mask(t)
        self.assertIn(DEV, out)
        self.assertIn("/etc/homebeacon/unoq.key", out)
        self.assertIn("a1" * 32, out, "release checksums are not secrets")
        self.assertIn("/opt/homebeacon-unoq/releases/1.2.3/current", out)

    def test_known_secret_is_replaced_even_in_odd_text(self):
        self.assertNotIn("sekret-value-9", support.mask("weird sekret-value-9 text", ["sekret-value-9"]))

    def test_mask_obj_hides_secret_named_fields(self):
        out = support.mask_obj({"password": "x1", "nested": {"api_key": "abc", "ok": "fine"}, "list": [f"Bearer {'q' * 20}"]})
        self.assertEqual(out["password"], support.MASK)
        self.assertEqual(out["nested"]["api_key"], support.MASK)
        self.assertEqual(out["nested"]["ok"], "fine")
        self.assertNotIn("q" * 20, json.dumps(out))


class DoctorChecks(Base):
    def test_healthy_hub_exits_zero_and_orders_checks(self):
        res = self.run_doctor()
        self.assertEqual([c for c in res], ["config", "key_storage", "device_id", "service", "serial_port", "disk", "time_sync", "dns", "tls",
                                            "api_ready", "clock", "key_accepted", "cloud_visible", "queue", "uplink", "box_link", "update", "restarts"])
        bad = {n: (c.level, c.detail) for n, c in res.items() if c.level in (doctor.WARN, doctor.FAIL)}
        self.assertEqual(bad, {}, bad)
        self.assertEqual(doctor.exit_code(list(res.values())), 0)

    def test_key_file_readable_by_others_fails_with_exact_fix(self):
        self.write_env(0o644)
        c = self.run_doctor()["key_storage"]
        self.assertEqual(c.level, doctor.FAIL)
        self.assertEqual(c.fix, f"sudo chown root:homebeacon {self.env_file} && sudo chmod 640 {self.env_file}")

    def test_missing_key_and_bad_device_id(self):
        os.unlink(self.env_file)
        res = self.run_doctor()
        self.assertEqual(res["key_storage"].level, doctor.FAIL)
        self.assertEqual(res["key_accepted"].level, doctor.SKIP)
        self.cfg.device_id = "serial-1234"
        self.assertEqual(self.run_doctor(self.cfg)["device_id"].level, doctor.FAIL)
        self.cfg.device_id = ""
        self.assertIn("24-character", self.run_doctor(self.cfg)["device_id"].fix)

    def test_rejected_key_is_explained_and_surfaced_in_uplink(self):
        res = self.run_doctor(probes=self.probes(api_settings=lambda: Result(401, {"error": "Invalid device key"})),
                              uplink_state={"state": "key_rejected", "key_rejected": True, "last_ok_wall": NOW - 99999})
        self.assertEqual(res["key_accepted"].level, doctor.FAIL)
        self.assertIn("key was rejected, or this device is not registered", res["key_accepted"].detail)
        self.assertEqual(res["cloud_visible"].level, doctor.FAIL)
        self.assertEqual(res["uplink"].level, doctor.FAIL)
        self.assertIn("device key rejected", res["uplink"].detail)
        self.assertIn("setup", res["uplink"].fix)

    def test_dns_failure_skips_dependent_checks(self):
        def boom(h, timeout=5.0):
            raise OSError("no")
        res = self.run_doctor(probes=self.probes(resolve=boom))
        self.assertEqual(res["dns"].level, doctor.FAIL)
        for n in ("tls", "api_ready", "key_accepted"):
            self.assertEqual(res[n].level, doctor.SKIP, n)

    def test_certificate_error_points_at_clock_or_login_page(self):
        def bad(h, p, timeout=6.0):
            raise ssl.SSLCertVerificationError("x")
        c = self.run_doctor(probes=self.probes(tls=bad))["tls"]
        self.assertEqual(c.level, doctor.FAIL)
        self.assertIn("clock", c.detail)

    def test_clock_skew_thresholds(self):
        for skew, level in ((5, doctor.PASS), (45, doctor.WARN), (400, doctor.FAIL)):
            p = self.probes(http_get=lambda u, h=None, timeout=8.0, s=skew: (200, {"Date": http_date(NOW - s)}, b'{"status":"ready"}'))
            c = self.run_doctor(probes=p)["clock"]
            self.assertEqual(c.level, level, (skew, c.detail))
        p = self.probes(now=lambda: 1_500_000_000.0)
        self.assertEqual(self.run_doctor(probes=p)["clock"].level, doctor.FAIL)

    def test_captive_portal_page_is_a_warning(self):
        p = self.probes(http_get=lambda u, h=None, timeout=8.0: (200, {}, b"<html>Sign in to Wi-Fi</html>"))
        self.assertEqual(self.run_doctor(probes=p)["api_ready"].level, doctor.WARN)

    def test_service_states(self):
        def mk(active):
            return self.probes(run=lambda cmd, timeout=5.0: (3, active) if cmd[1] == "is-active" else (0, "enabled") if cmd[1] == "is-enabled" else (0, "0"))
        c = self.run_doctor(probes=mk("failed"))["service"]
        self.assertEqual(c.level, doctor.FAIL)
        self.assertIn("systemctl enable --now homebeacon-unoq", c.fix)
        self.assertEqual(self.run_doctor(probes=self.probes(run=lambda cmd, timeout=5.0: (127, "")))["service"].level, doctor.SKIP)

    def test_restart_counts(self):
        def mk(n):
            return self.probes(run=lambda cmd, timeout=5.0: (0, str(n)) if cmd[1] == "show" and cmd[0] == "systemctl" else (0, "active") if cmd[1] == "is-active" else (0, "enabled"))
        self.assertEqual(self.run_doctor(probes=mk(1))["restarts"].level, doctor.PASS)
        self.assertEqual(self.run_doctor(probes=mk(4))["restarts"].level, doctor.WARN)
        self.assertEqual(self.run_doctor(probes=mk(12))["restarts"].level, doctor.FAIL)

    def test_serial_missing_and_permission(self):
        self.cfg.mcu_source = "serial"
        self.cfg.mcu_port = os.path.join(self.d, "ttyACM9")
        self.assertEqual(self.run_doctor(self.cfg)["serial_port"].level, doctor.FAIL)
        open(self.cfg.mcu_port, "w").close()
        os.chmod(self.cfg.mcu_port, 0o000)
        with mock.patch.object(doctor, "_can_open", return_value=(False, "owned by group dialout")):
            c = self.run_doctor(self.cfg)["serial_port"]
        self.assertEqual(c.level, doctor.FAIL)
        self.assertIn("usermod -aG dialout homebeacon", c.fix)
        with mock.patch.object(doctor, "_can_open", return_value=(True, "")):
            self.assertEqual(self.run_doctor(self.cfg)["serial_port"].level, doctor.PASS)

    def test_disk_thresholds(self):
        U = type("U", (), {})
        for free_mb, level in ((900, doctor.PASS), (120, doctor.WARN), (20, doctor.FAIL)):
            u = U()
            u.free = free_mb * 1_000_000
            with mock.patch.object(doctor.shutil, "disk_usage", return_value=u):
                self.assertEqual(self.run_doctor()["disk"].level, level, free_mb)

    def test_queue_depth_and_oldest_age(self):
        s = Store(os.path.join(self.state, "agent.sqlite"), max_rows=100)
        try:
            real = self.probes(now=time.time)
            self.assertEqual(self.run_doctor(store=s, probes=real)["queue"].level, doctor.PASS)
            s.push("ingest", {"readings": []}, PRIO_ROUTINE, now=time.time() - 7200)
            c = self.run_doctor(store=s, probes=real)["queue"]
            self.assertEqual(c.level, doctor.WARN)
            self.assertIn("2 h old", c.detail)
            s.push("ingest", {"readings": []}, PRIO_CRITICAL, now=time.time() - 200000)
            self.assertEqual(self.run_doctor(store=s, probes=real)["queue"].level, doctor.FAIL)
            # read-only path while the agent holds the file open
            res = self.run_doctor(queue_path=os.path.join(self.state, "agent.sqlite"), probes=real)
            self.assertEqual(res["queue"].level, doctor.FAIL)
        finally:
            s.close()

    def test_uplink_age_and_circuit(self):
        old = self.run_doctor(uplink_state={"state": "closed", "last_ok_wall": NOW - 4000},
                              probes=self.probes(local_status=lambda p: None))
        self.assertEqual(old["uplink"].level, doctor.WARN)
        very = self.run_doctor(uplink_state={"state": "closed", "last_ok_wall": NOW - 90000}, probes=self.probes(local_status=lambda p: None))
        self.assertEqual(very["uplink"].level, doctor.FAIL)
        opened = self.run_doctor(uplink_state={"state": "open", "retry_in_s": 120, "last_ok_wall": NOW - 100})
        self.assertEqual(opened["uplink"].level, doctor.WARN)
        none = self.run_doctor(uplink_state=None, probes=self.probes(local_status=lambda p: None))
        self.assertIn(none["uplink"].level, (doctor.WARN,))

    def test_box_link(self):
        self.cfg.mcu_source = "serial"
        down = self.probes(local_status=lambda p: {"mcu": {"connected": False, "error": "no device"}})
        self.cfg.mcu_port = os.path.join(self.d, "p")
        self.assertEqual(self.run_doctor(self.cfg, probes=down)["box_link"].level, doctor.FAIL)
        stale = self.probes(local_status=lambda p: {"mcu": {"connected": True}, "live": {"boxes": {"A": {"age_s": 900.0}}}})
        self.assertEqual(self.run_doctor(self.cfg, probes=stale)["box_link"].level, doctor.WARN)
        self.assertEqual(self.run_doctor(self.cfg, probes=self.probes(local_status=lambda p: None))["box_link"].level, doctor.WARN)

    def test_update_status_interpretation(self):
        rb = {"current": "1.0.0", "last_rollback": {"at": NOW - 3600, "reason": "crash loop", "to_version": "1.0.0"}}
        self.assertEqual(self.run_doctor(update_status=rb)["update"].level, doctor.WARN)
        self.assertEqual(self.run_doctor(update_status={"current": "1.0.0", "pending": {"version": "1.1.0"}})["update"].level, doctor.WARN)
        old_rb = {"current": "1.0.0", "last_rollback": {"at": NOW - 40 * 86400}}
        self.assertEqual(self.run_doctor(update_status=old_rb)["update"].level, doctor.PASS)

    def test_offline_mode_skips_network_checks_only(self):
        res = self.run_doctor(offline=True)
        for n in ("dns", "tls", "api_ready", "key_accepted", "cloud_visible"):
            self.assertEqual(res[n].level, doctor.SKIP, n)
        self.assertEqual(res["config"].level, doctor.PASS)

    def test_crashing_check_is_reported_not_raised(self):
        def c_boom(x):
            raise RuntimeError("boom")

        with mock.patch.object(doctor, "CHECKS", (doctor.c_config, c_boom)):
            out = doctor.run_checks(self.cfg, config_path=self.cfg_path, env_file=self.env_file, probes=self.probes(),
                                    update_status={}, uplink_state={})
        self.assertEqual((out[1].name, out[1].level), ("boom", doctor.WARN))

    def test_key_never_appears_in_any_rendering(self):
        res = list(self.run_doctor(probes=self.probes(api_settings=lambda: Result(401, {"error": f"bad {KEY}"}))).values())
        text = doctor.render(res) + json.dumps([c.as_dict() for c in res])
        self.assertNotIn(KEY, text)

    def test_exit_codes(self):
        C = doctor.Check
        self.assertEqual(doctor.exit_code([C("a", doctor.PASS, ""), C("b", doctor.SKIP, "")]), 0)
        self.assertEqual(doctor.exit_code([C("a", doctor.WARN, ""), C("b", doctor.PASS, "")]), 1)
        self.assertEqual(doctor.exit_code([C("a", doctor.WARN, ""), C("b", doctor.FAIL, "")]), 2)


class Cli(Base):
    def run_cli(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = cli.main(["--config", self.cfg_path, *argv])
        return code, out.getvalue(), err.getvalue()

    def test_doctor_json_offline_and_exit_code(self):
        code, out, _ = self.run_cli("doctor", "--offline", "--json", "--env-file", self.env_file)
        data = json.loads(out)
        self.assertEqual(data["exit_code"], code)
        self.assertEqual(data["checks"][0]["name"], "config")
        self.assertNotIn(KEY, out)

    def test_doctor_with_broken_config_is_a_clear_fail(self):
        open(self.cfg_path, "w").write("[api]\nbase_url = \"http://example.com\"\n")
        code, out, _ = self.run_cli("doctor", "--env-file", self.env_file)
        self.assertEqual(code, 2)
        self.assertIn("FAIL", out)
        self.assertIn("https", out)

    def test_update_command_uses_module_a_when_present_and_falls_back_when_not(self):
        calls = []
        with mock.patch.object(updater, "update_status", lambda cfg=None: calls.append(cfg) or {"current": "9.9.9", "ok": True}, create=True):
            code, out, _ = self.run_cli("update", "status")
        self.assertEqual(code, 0)
        self.assertIn("current: 9.9.9", out)
        self.assertEqual(len(calls), 1)
        with mock.patch.object(updater, "update_apply", None, create=True):
            code, _, err = self.run_cli("update", "apply")
        self.assertEqual(code, 1)
        self.assertIn("not available", err)
        with mock.patch.object(updater, "update_rollback", lambda cfg=None: {"ok": False, "error": "nothing to roll back"}, create=True):
            self.assertEqual(self.run_cli("update", "rollback")[0], 1)

    def test_env_json_is_masked(self):
        with mock.patch.object(support, "environment", return_value={"note": f"leak {KEY}", "python": "3.11"}):
            code, out, _ = self.run_cli("env", "--json", "--env-file", self.env_file)
        self.assertEqual(code, 0)
        self.assertNotIn(KEY, out)
        self.assertIn("3.11", out)

    def test_logs_command_masks(self):
        log = os.path.join(self.d, "agent.log")
        open(log, "w").write("\n".join(f"line {i}" for i in range(50)) + f"\nsent with X-Device-Key: {KEY}\n")
        self.cfg_path = os.path.join(self.d, "c2.toml")
        open(self.cfg_path, "w").write(f'[api]\ndevice_id = "{DEV}"\n[agent]\nstate_dir = "{self.state}"\nlog_file = "{log}"\n[mcu]\nsource = "none"\n')
        code, out, _ = self.run_cli("logs", "-n", "5", "--env-file", self.env_file)
        self.assertEqual(code, 0)
        self.assertEqual(len(out.strip().splitlines()), 5)
        self.assertNotIn(KEY, out)
        self.assertIn(support.MASK, out)


class Bundle(Base):
    def make_log(self, n=400):
        log = os.path.join(self.d, "agent.log")
        with open(log, "w") as f:
            for i in range(n):
                f.write(f"2026-01-01 INFO event {i} X-Device-Key: {KEY} https://user:pw@h.example/x\n")
        self.cfg.log_file = log
        return log

    def test_bundle_is_private_capped_masked_and_complete(self):
        self.make_log()
        s = Store(os.path.join(self.state, "agent.sqlite"))
        s.push("event", {"type": "agent.secret_payload", "data": {"note": "PAYLOAD-BODY-MARKER"}}, PRIO_ROUTINE)
        stats = doctor.read_queue_stats(os.path.join(self.state, "agent.sqlite"), time.time())
        s.close()
        report = [c.as_dict() for c in self.run_doctor().values()]
        info = support.build_bundle(self.cfg, queue_stats=stats, report=report, update_status={"current": "1.0.0", "token": "abc12345"},
                                    status={"version": "1", "note": f"has {KEY}"}, key=KEY, log_n=300, now=NOW,
                                    uplink_state={"state": "closed"}, run=lambda c, t=5.0: (127, ""))
        path = info["path"]
        self.assertTrue(path.startswith(os.path.join(self.state, "support")))
        self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(os.stat(os.path.dirname(path)).st_mode), 0o700)
        self.assertLessEqual(os.path.getsize(path), support.MAX_BUNDLE)
        raw = open(path, "rb").read()
        self.assertNotIn(KEY.encode(), raw)
        with tarfile.open(path) as tar:
            names = tar.getnames()
            texts = {n: tar.extractfile(n).read().decode() for n in names}
            self.assertTrue(all(m.mode == 0o600 for m in tar.getmembers()))
        for must in ("README.txt", "versions.json", "config.json", "environment.json", "queue.json", "doctor.json", "doctor.txt", "log_tail.txt", "update.json", "status.json", "uplink_health.json"):
            self.assertIn(must, names)
        blob = "\n".join(texts.values())
        for leak in (KEY, "user:pw@", "abc12345"):
            self.assertNotIn(leak, blob)
        self.assertNotIn("PAYLOAD-BODY-MARKER", blob, "queue payloads never go into a bundle")
        self.assertIn(DEV, texts["config.json"])
        self.assertEqual(len(texts["log_tail.txt"].strip().splitlines()), 301)         # header + 300 lines
        self.assertEqual(json.loads(texts["queue.json"])["rows"], 1)

    def test_oversized_log_is_shortened_not_the_bundle_refused(self):
        log = os.path.join(self.d, "big.log")
        import random as r
        rng = r.Random(1)
        with open(log, "w") as f:
            for i in range(3000):
                f.write("".join(rng.choice("abcdefghijklmnopqrstuvwxyz ") for _ in range(120)) + "\n")
        self.cfg.log_file = log
        info = support.build_bundle(self.cfg, key=KEY, log_n=3000, now=NOW, run=lambda c, t=5.0: (127, ""))
        self.assertLessEqual(info["bytes"], support.MAX_BUNDLE)

    def test_only_the_newest_five_bundles_are_kept(self):
        for i in range(8):
            support.build_bundle(self.cfg, key=KEY, log_n=5, now=NOW + i * 10, run=lambda c, t=5.0: (127, ""))
        files = os.listdir(os.path.join(self.state, "support"))
        self.assertEqual(len(files), support.KEEP_BUNDLES)

    def test_refuses_when_the_key_would_leak_through_an_unmasked_path(self):
        with mock.patch.object(support, "mask", side_effect=lambda t, s=(): t), mock.patch.object(support, "mask_obj", side_effect=lambda o, s=(): o):
            self.cfg.log_file = self.make_log(3)
            with self.assertRaises(OSError):
                support.build_bundle(self.cfg, key=KEY, log_n=5, now=NOW, run=lambda c, t=5.0: (127, ""))
        self.assertFalse(os.path.exists(os.path.join(self.state, "support")) and os.listdir(os.path.join(self.state, "support")))

    def test_support_bundle_cli_writes_one_file_and_says_nothing_was_uploaded(self):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = cli.main(["--config", self.cfg_path, "support-bundle", "--offline", "--env-file", self.env_file, "--lines", "20",
                             "--url", "http://127.0.0.1:9"])
        self.assertEqual(code, 0, err.getvalue())
        self.assertIn("Nothing was uploaded", out.getvalue())
        self.assertEqual(len(os.listdir(os.path.join(self.state, "support"))), 1)
        self.assertNotIn(KEY, out.getvalue())


if __name__ == "__main__":
    unittest.main()
