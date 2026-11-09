"""End to end against a local mock hub and a temp install prefix (no root, no real /opt, no real network).

Covers: self-update to a newer release, a bad release that is rolled back (crash loop and failed health),
the agent loop wiring (boot guard, environment report, restart request), doctor against a working and a broken
setup, and a support bundle scanned for secrets.
"""
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import unittest

from hbagent import bootguard as bg
from hbagent import config, lifecycle, mcu, updater
from hbagent.agent import Agent
from hbagent.store import Store
from hbagent.uplink import Api

from mockhub import MockHub, SRC, build_release

RUN_AGENT = os.path.join(SRC, "run_agent.py")
# Passes the install-time self test, then crashes whenever it is started for real.
CRASHER = "import sys\nsys.exit(0 if sys.argv[-1] == 'selftest' else 1)\n"


def unpack(tgz, dest):
    os.makedirs(dest, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(tgz), mode="r:gz") as tf:
        for m in tf.getmembers():
            m.name = m.name.split("/", 1)[1] if "/" in m.name else ""
            if m.name:
                tf.extract(m, dest, filter="data")


class E2E(unittest.TestCase):
    def setUp(self):
        self.hub = MockHub()
        self.tmp = tempfile.mkdtemp(prefix="hbe")
        self.prefix = os.path.join(self.tmp, "opt")
        self.state = os.path.join(self.tmp, "st")
        os.makedirs(self.state, mode=0o700)
        unpack(build_release("0.1.0"), bg.release_path(self.prefix, "0.1.0"))
        bg.swap_link(self.prefix, "current", "0.1.0")
        self.cfg_path = os.path.join(self.tmp, "unoq.toml")
        self.write_cfg()
        self.env = {**os.environ, "HB_PREFIX": self.prefix, "HB_UPDATE_CONF": os.path.join(self.tmp, "none.toml"), "HB_BASE": self.hub.url,
                    "HB_DEVICE_KEY": self.hub.key, "PYTHONDONTWRITEBYTECODE": "1"}
        for k in ("HB_UPDATE_CHANNEL", "HB_UPDATE_PUBKEY", "HB_UPDATE_INTERVAL_S"):
            self.env.pop(k, None)
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.addCleanup(self.hub.stop)

    def write_cfg(self, base=None, device_id=None, log_file=None):
        with open(self.cfg_path, "w") as f:
            f.write(f'[api]\nbase_url = "{base or self.hub.url}"\ndevice_id = "{device_id or self.hub.device_id}"\n'
                    f'[agent]\nstate_dir = "{self.state}"\n' + (f'log_file = "{log_file}"\n' if log_file else "") + '[mcu]\nsource = "none"\n[status]\nport = 0\n')

    def cli(self, *args, env=None):
        r = subprocess.run([sys.executable, "-B", RUN_AGENT, "--config", self.cfg_path, *args], capture_output=True, text=True,
                           timeout=120, env={**self.env, **(env or {})}, cwd=self.tmp)
        return r.returncode, r.stdout, r.stderr

    def cur(self):
        return bg.current_version(self.prefix)

    # ------------------------------------------------------------------ update
    def test_update_to_newer_release_then_confirmed_healthy(self):
        self.hub.publish("0.1.1")
        rc, out, _ = self.cli("update", "check", "--json")
        info = json.loads(out)
        self.assertTrue(info["update_available"], out)
        self.assertEqual(info["latest"], "0.1.1")
        rc, out, err = self.cli("update", "apply", "--json")
        res = json.loads(out)
        self.assertEqual(res["outcome"], "installed", (out, err))
        self.assertTrue(res["restart_required"])
        self.assertEqual((self.cur(), bg.previous_version(self.prefix)), ("0.1.1", "0.1.0"))
        st = bg.load_state(self.state)
        self.assertEqual(st["pending"]["version"], "0.1.1")
        # The new release reaches the cloud: update confirmed, old release kept as previous.
        done = bg.Guard(self.prefix, self.state).record_healthy("uplink")
        self.assertEqual(done["to_version"], "0.1.1")
        self.assertIsNone(bg.load_state(self.state)["pending"])
        pushed = []
        updater.flush_events(config.Config(state_dir=self.state), lambda t, d: pushed.append((t, d)))
        self.assertEqual([d["outcome"] for t, d in pushed], ["started", "succeeded"])
        self.assertTrue(all(t == "agent.update" for t, _ in pushed))
        # And the installed release runs: its own selftest passes from the new folder.
        r = subprocess.run([sys.executable, "-I", "-B", os.path.join(self.prefix, "current", "run_agent.py"), "selftest"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_same_or_older_release_is_not_installed(self):
        self.hub.publish("0.1.0")
        rc, out, _ = self.cli("update", "apply", "--json")
        self.assertEqual(json.loads(out)["outcome"], "none")
        self.assertEqual(self.cur(), "0.1.0")

    def test_tampered_download_is_refused_and_nothing_changes(self):
        self.hub.publish("0.1.1")
        self.hub.files["homebeacon-unoq-0.1.1.tar.gz"] = self.hub.files["homebeacon-unoq-0.1.1.tar.gz"][:-5] + b"xxxxx"
        rc, out, _ = self.cli("update", "apply", "--json")
        self.assertEqual(json.loads(out)["outcome"], "failed")
        self.assertEqual(self.cur(), "0.1.0")
        self.assertIsNone(bg.load_state(self.state).get("pending"))

    def test_bad_release_that_crashes_on_start_is_rolled_back_and_not_retried(self):
        self.hub.publish("0.1.2", run_agent_override=CRASHER)
        rc, out, _ = self.cli("update", "apply", "--json")
        self.assertEqual(json.loads(out)["outcome"], "installed", out)
        t = [time.time()]
        g = bg.Guard(self.prefix, self.state, clock=lambda: t[0])
        rolled = None
        for _ in range(6):                      # systemd keeps restarting the crashing service
            t[0] += 60
            info = g.record_start()
            if info["rolled_back"]:
                rolled = info
                break
        self.assertIsNotNone(rolled, "crash loop must trigger a rollback")
        self.assertEqual(self.cur(), "0.1.0")
        self.assertIn("0.1.2", bg.load_state(self.state)["bad"])
        rc, out, _ = self.cli("update", "check", "--json")
        chk = json.loads(out)
        self.assertFalse(chk["update_available"], "a version that was rolled back is skipped")
        pushed = []
        updater.flush_events(config.Config(state_dir=self.state), lambda t_, d: pushed.append(d["outcome"]))
        self.assertIn("rolled_back", pushed)

    def test_bad_release_that_runs_but_never_gets_healthy_is_rolled_back_after_the_deadline(self):
        self.hub.publish("0.1.1")
        self.assertEqual(json.loads(self.cli("update", "apply", "--json")[1])["outcome"], "installed")
        with open(os.path.join(bg.release_path(self.prefix, "0.1.1"), "run_agent.py"), "w") as f:
            f.write("import sys\nsys.exit(1)\n")            # selftest would fail too: no healthy by selftest either
        t = [time.time()]
        s = updater.Settings(prefix=self.prefix, state_dir=self.state, base=self.hub.url, port=0)
        self.assertEqual(updater.health_tick(None, {"uplink": {"last_ok_age_s": None}}, settings=s, now=lambda: t[0])["action"], "none")
        t[0] += 700
        res = updater.health_tick(None, {"uplink": {"last_ok_age_s": None}}, settings=s, now=lambda: t[0])
        self.assertEqual(res["action"], "restart", res)
        self.assertEqual(self.cur(), "0.1.0")

    def test_rollback_command_goes_back_to_previous(self):
        self.hub.publish("0.1.1")
        self.cli("update", "apply", "--json")
        bg.Guard(self.prefix, self.state).record_healthy()
        rc, out, _ = self.cli("update", "rollback", "--json")
        self.assertEqual(rc, 0, out)
        self.assertEqual(self.cur(), "0.1.0")

    # ------------------------------------------------------------------ the agent loop wiring
    def make_agent(self, key=None, mode_dir=None):
        cfg = config.Config(base_url=self.hub.url, device_id=self.hub.device_id, state_dir=self.state, status_port=0, mcu_source="fake",
                            assume_mains="present").validate()
        store = Store(os.path.join(self.state, "a.sqlite"))
        api = Api(cfg.base_url, key or self.hub.key, 3.0)
        agent = Agent(cfg, store, api, mcu.FakeSource(scripted=[]))
        self.addCleanup(store.close)
        self.addCleanup(api.close)
        return cfg, store, agent

    def join_workers(self, lc):
        for th in list(lc._workers.values()):
            th.join(20)

    def test_loop_confirms_a_pending_update_once_the_hub_accepts_data(self):
        self.hub.publish("0.1.1")
        self.cli("update", "apply", "--json")
        cfg, store, agent = self.make_agent()
        lc = lifecycle.Lifecycle(agent, cfg, store, prefix=self.prefix, auto_update=False).install()
        self.assertTrue(lc.managed)
        for _ in range(30):
            agent.step()
            self.join_workers(lc)
            lc._next_health = 0
            if bg.load_state(self.state)["pending"] is None:
                break
            time.sleep(0.2)
        self.assertIsNone(bg.load_state(self.state)["pending"], "update must be confirmed by a working uplink")
        self.assertEqual(self.cur(), "0.1.1")
        agent.shutdown()
        self.assertIn("agent.environment", self.hub.event_types(), "environment report is uploaded at boot")
        self.assertIn("agent.update", self.hub.event_types())
        st = agent.status()
        self.assertIn("env", st)
        self.assertNotIn(self.hub.key, json.dumps(st, default=str))

    def test_loop_requests_a_restart_after_an_automatic_rollback(self):
        self.hub.publish("0.1.1")
        self.cli("update", "apply", "--json")
        with open(os.path.join(bg.release_path(self.prefix, "0.1.1"), "run_agent.py"), "w") as f:
            f.write("import sys\nsys.exit(1)\n")
        self.hub.mode = "outage"
        cfg, store, agent = self.make_agent()
        t = [time.time()]
        lc = lifecycle.Lifecycle(agent, cfg, store, prefix=self.prefix, auto_update=False, clock=lambda: t[0]).install()
        t[0] += 800
        lc._next_health = 0
        lc.before_step()
        self.join_workers(lc)
        self.assertEqual(agent.exit_code, 75)
        self.assertTrue(agent.stop.is_set())
        self.assertEqual(self.cur(), "0.1.0")

    def test_loop_does_nothing_risky_when_not_installed_by_the_installer(self):
        shutil.rmtree(self.prefix)
        cfg, store, agent = self.make_agent()
        lc = lifecycle.Lifecycle(agent, cfg, store, prefix=self.prefix).install()
        self.assertFalse(lc.managed)
        agent.step()
        self.join_workers(lc)
        self.assertFalse(os.path.exists(os.path.join(self.state, "update.json")) and bg.load_state(self.state).get("pending"))

    # ------------------------------------------------------------------ doctor and support bundle
    def test_doctor_against_a_working_hub_has_no_failures(self):
        rc, out, err = self.cli("doctor", "--json", "--env-file", os.path.join(self.tmp, "none.env"))
        data = json.loads(out)
        fails = [c for c in data["checks"] if c["level"] == "FAIL"]
        # Hardware, service and key-file checks are expected to differ on a dev machine; the cloud ones must pass.
        cloud = {c["name"]: c["level"] for c in data["checks"] if c["name"] in ("dns", "tls", "api_ready", "key_accepted")}
        self.assertTrue(cloud, data)
        self.assertTrue(all(v in ("PASS", "SKIP") for v in cloud.values()), (cloud, fails))

    def test_doctor_with_a_rejected_key_says_so_with_a_fix(self):
        self.hub.mode = "reject"
        rc, out, _ = self.cli("doctor", "--json", "--env-file", os.path.join(self.tmp, "none.env"))
        data = json.loads(out)
        bad = [c for c in data["checks"] if c["level"] == "FAIL" and "key" in c["name"]]
        self.assertTrue(bad, data)
        self.assertTrue(all(c.get("fix") for c in bad))
        self.assertEqual(rc, 2)

    def test_doctor_with_no_key_and_bad_url_fails_with_fixes(self):
        self.write_cfg(base="https://nonexistent.invalid")
        rc, out, _ = self.cli("doctor", "--json", "--env-file", os.path.join(self.tmp, "none.env"), env={"HB_DEVICE_KEY": ""})
        data = json.loads(out)
        fails = [c for c in data["checks"] if c["level"] == "FAIL"]
        self.assertGreaterEqual(len(fails), 2)
        self.assertTrue(all(c.get("fix") for c in fails))
        self.assertEqual(rc, 2)

    def test_support_bundle_contains_no_secrets(self):
        log = os.path.join(self.tmp, "agent.log")
        with open(log, "w") as f:
            f.write(f"boot ok\nrequest header X-Device-Key: {self.hub.key}\nBearer abcdefghijklmnop1234\nurl https://u:pw123456@host.test/x\n")
        self.write_cfg(log_file=log)
        out_dir = os.path.join(self.tmp, "bundles")
        rc, out, err = self.cli("support-bundle", "--out-dir", out_dir, "--env-file", os.path.join(self.tmp, "none.env"), "--offline")
        self.assertEqual(rc, 0, (out, err))
        files = [os.path.join(out_dir, f) for f in os.listdir(out_dir)]
        self.assertEqual(len(files), 1)
        self.assertEqual(oct(os.stat(files[0]).st_mode & 0o777), "0o600")
        blob = b""
        with tarfile.open(files[0]) as tf:
            for m in tf.getmembers():
                if m.isfile():
                    blob += tf.extractfile(m).read()
        text = blob.decode("utf-8", "replace")
        for secret in (self.hub.key, "abcdefghijklmnop1234", "pw123456"):
            self.assertNotIn(secret, text)
        self.assertLess(os.path.getsize(files[0]), 400_000)


if __name__ == "__main__":
    unittest.main()
