"""Updater and boot guard: staged install, atomic switch, crash-loop rollback, honest trust reporting.

No network and no real /opt: every path lives in a temp folder and downloads come from a fake opener.
"""
import hashlib
import io
import json
import os
import random
import shutil
import subprocess
import tarfile
import tempfile
import unittest

from hbagent import bootguard as bg
from hbagent import updater

BASE = "https://example.test"


def make_tarball(version, extra=None, selftest_ok=True, bad_version_file=False):
    """A minimal fake release. run_agent.py selftest exits 0 or 1."""
    top = f"homebeacon-unoq-{version}"
    files = {
        "run_agent.py": f"import sys\nsys.exit({0 if selftest_ok else 1})\n",
        "VERSION": ("9.9.9" if bad_version_file else version) + "\n",
        "hbagent/agent.py": "# agent\n",
        "hbagent/bootguard.py": "# guard\n",
        "hbagent/updater.py": "# updater\n",
    }
    files.update(extra or {})
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for name, text in files.items():
            data = text.encode()
            ti = tarfile.TarInfo(f"{top}/{name}")
            ti.size, ti.mode = len(data), 0o644
            tf.addfile(ti, io.BytesIO(data))
    return buf.getvalue()


class FakeOpener:
    """Serves bytes by URL path suffix. Counts requests."""

    def __init__(self, routes):
        self.routes, self.hits = routes, []

    def open(self, req, timeout=None):
        url = req.full_url
        self.hits.append(url)
        for suffix, data in self.routes.items():
            if url.endswith(suffix):
                bio = io.BytesIO(data)
                bio.__enter__ = lambda s=bio: s
                return _Ctx(bio)
        import urllib.error
        raise urllib.error.URLError("not found")


class _Ctx:
    def __init__(self, bio):
        self.bio = bio

    def __enter__(self):
        return self.bio

    def __exit__(self, *a):
        return False


def release_routes(version, critical=None, channel=None, signature=None, tar_bytes=None, **kw):
    tgz = tar_bytes if tar_bytes is not None else make_tarball(version, **kw)
    m = {"name": "homebeacon-unoq", "version": version, "file": f"homebeacon-unoq-{version}.tar.gz",
         "size": len(tgz), "sha256": hashlib.sha256(tgz).hexdigest()}
    if critical is not None:
        m["critical"] = critical
    if channel:
        m["channel"] = channel
    routes = {f"homebeacon-unoq-{version}.tar.gz": tgz}
    if signature is not None:
        m["signature"] = f"homebeacon-unoq-{version}.tar.gz.sig"
        routes[m["signature"]] = signature
    name = "manifest.json" if channel in (None, "stable") else f"manifest-{channel}.json"
    routes["/downloads/unoq/" + name] = json.dumps(m).encode()
    return routes, m


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="hbup-")
        self.prefix = os.path.join(self.tmp, "opt")
        self.state = os.path.join(self.tmp, "state")
        os.makedirs(self.state, mode=0o700)
        self.t = [1_000_000.0]
        self.clock = lambda: self.t[0]
        self.settings = updater.Settings(prefix=self.prefix, state_dir=self.state, base=BASE, port=0)
        self.install_release("0.1.0")
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def install_release(self, ver, current=True):
        p = bg.release_path(self.prefix, ver)
        os.makedirs(os.path.join(p, "hbagent"))
        for f, body in (("run_agent.py", "import sys\nsys.exit(0)\n"), ("VERSION", ver + "\n"), ("hbagent/agent.py", "#\n")):
            with open(os.path.join(p, f), "w") as fh:
                fh.write(body)
        if current:
            bg.swap_link(self.prefix, "current", ver)

    def apply(self, routes, **kw):
        kw.setdefault("hazard", False)
        kw.setdefault("run_selftest", False)
        return updater.update_apply(None, opener=FakeOpener(routes), settings=self.settings, now=self.clock, **kw)

    def outbox(self):
        return bg.load_json(os.path.join(self.state, "update_events.json"), [])

    def outcomes(self):
        return [e["data"]["outcome"] for e in self.outbox()]


class ApplyTests(Base):
    def test_happy_path_switches_atomically_and_arms_the_guard(self):
        routes, m = release_routes("0.2.0")
        res = self.apply(routes)
        self.assertTrue(res["ok"], res)
        self.assertEqual(res["outcome"], "installed")
        self.assertEqual(res["signature"], "unsigned")
        self.assertTrue(res["restart_required"])
        self.assertEqual(res["restart_exit_code"], 75)
        self.assertEqual(bg.current_version(self.prefix), "0.2.0")
        self.assertEqual(bg.previous_version(self.prefix), "0.1.0")
        self.assertEqual(bg.load_state(self.state)["pending"]["version"], "0.2.0")
        self.assertEqual(self.outcomes(), ["started"])
        self.assertEqual(os.listdir(os.path.join(self.state, "updates")), [])      # staged tarball removed
        self.assertFalse(os.path.exists(bg.release_path(self.prefix, "0.2.0") + ".new"))

    def test_wrong_checksum_is_discarded_and_nothing_changes(self):
        routes, m = release_routes("0.2.0")
        data = bytearray(routes["homebeacon-unoq-0.2.0.tar.gz"])
        data[-5] ^= 0xFF
        routes["homebeacon-unoq-0.2.0.tar.gz"] = bytes(data)
        res = self.apply(routes)
        self.assertEqual(res["outcome"], "failed")
        self.assertEqual(bg.current_version(self.prefix), "0.1.0")
        self.assertEqual(os.listdir(os.path.join(self.state, "updates")), [])
        self.assertIsNone(bg.load_state(self.state).get("pending"))
        self.assertEqual(self.outcomes(), ["started", "failed"])

    def test_never_downgrades_or_reinstalls(self):
        routes, _ = release_routes("0.1.0")
        self.assertEqual(self.apply(routes)["outcome"], "none")
        routes, _ = release_routes("0.0.9")
        self.assertEqual(self.apply(routes)["outcome"], "none")
        self.assertEqual(bg.current_version(self.prefix), "0.1.0")

    def test_hazard_defers_unless_critical(self):
        routes, _ = release_routes("0.2.0")
        res = self.apply(routes, hazard=True)
        self.assertEqual(res["outcome"], "deferred")
        self.assertEqual(bg.current_version(self.prefix), "0.1.0")
        self.assertEqual(self.outcomes(), ["deferred"])
        routes, _ = release_routes("0.2.0", critical=True)
        self.assertEqual(self.apply(routes, hazard=True)["outcome"], "installed")

    def test_unsafe_archives_are_refused(self):
        for extra, why in (({"../evil.py": "x"}, "unsafe"), ):
            top = "homebeacon-unoq-0.2.0"
            buf = io.BytesIO()
            with tarfile.open(fileobj=buf, mode="w:gz") as tf:
                ti = tarfile.TarInfo(f"{top}/../evil.py")
                ti.size = 1
                tf.addfile(ti, io.BytesIO(b"x"))
            routes, _ = release_routes("0.2.0", tar_bytes=buf.getvalue())
            res = self.apply(routes)
            self.assertEqual(res["outcome"], "failed", res)
            self.assertFalse(os.path.exists(os.path.join(self.prefix, "evil.py")))
        # symlink member
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tf:
            ti = tarfile.TarInfo("homebeacon-unoq-0.2.0/link")
            ti.type, ti.linkname = tarfile.SYMTYPE, "/etc/passwd"
            tf.addfile(ti)
        routes, _ = release_routes("0.2.0", tar_bytes=buf.getvalue())
        self.assertEqual(self.apply(routes)["outcome"], "failed")
        self.assertEqual(bg.current_version(self.prefix), "0.1.0")

    def test_version_file_must_match_manifest(self):
        routes, _ = release_routes("0.2.0", bad_version_file=True)
        self.assertEqual(self.apply(routes)["outcome"], "failed")
        self.assertEqual(bg.current_version(self.prefix), "0.1.0")

    def test_failing_selftest_blocks_the_switch(self):
        routes, _ = release_routes("0.2.0", selftest_ok=False)
        res = self.apply(routes, run_selftest=True)
        self.assertEqual(res["outcome"], "failed")
        self.assertIn("self test", res["error"])
        self.assertEqual(bg.current_version(self.prefix), "0.1.0")
        self.assertEqual(bg.list_releases(self.prefix), ["0.1.0"])

    def test_passing_selftest_installs(self):
        routes, _ = release_routes("0.2.0")
        self.assertEqual(self.apply(routes, run_selftest=True)["outcome"], "installed")

    def test_oversize_download_is_cut_off(self):
        routes, m = release_routes("0.2.0")
        routes["homebeacon-unoq-0.2.0.tar.gz"] += b"0" * 5000          # more bytes than the manifest size
        res = self.apply(routes)
        self.assertEqual(res["outcome"], "failed")
        self.assertEqual(os.listdir(os.path.join(self.state, "updates")), [])

    def test_second_update_waits_for_the_first_to_be_verified(self):
        routes, _ = release_routes("0.2.0")
        self.apply(routes)
        routes, _ = release_routes("0.3.0")
        res = self.apply(routes)
        self.assertEqual(res["outcome"], "deferred")
        self.assertEqual(bg.current_version(self.prefix), "0.2.0")

    def test_lock_prevents_concurrent_updates(self):
        lk = bg.Lock(os.path.join(self.state, "update.lock"))
        self.assertTrue(lk.acquire())
        try:
            routes, _ = release_routes("0.2.0")
            res = self.apply(routes)
            self.assertEqual(res["outcome"], "failed")
            self.assertIn("already running", res["error"])
            self.assertTrue(updater.update_status(None, settings=self.settings)["update_running"])
        finally:
            lk.release()

    def test_channel_selects_the_manifest(self):
        self.settings.channel = "beta"
        routes, _ = release_routes("0.2.0", channel="beta")
        op = FakeOpener(routes)
        info = updater.update_check(None, opener=op, settings=self.settings, now=self.clock)
        self.assertTrue(info["update_available"])
        self.assertTrue(op.hits[0].endswith("/downloads/unoq/manifest-beta.json"))
        # a stable-labelled manifest served for the beta channel is rejected
        routes, _ = release_routes("0.2.0", channel="stable")
        routes["/downloads/unoq/manifest-beta.json"] = routes.pop("/downloads/unoq/manifest.json")
        info = updater.update_check(None, opener=FakeOpener(routes), settings=self.settings, now=self.clock)
        self.assertFalse(info["ok"])

    def test_http_and_bad_manifests_are_refused(self):
        self.settings.base = "http://example.test"
        routes, _ = release_routes("0.2.0")
        info = updater.update_check(None, opener=FakeOpener(routes), settings=self.settings, now=self.clock)
        self.assertFalse(info["ok"])
        self.settings.base = BASE
        bad = {"/downloads/unoq/manifest.json": json.dumps({"version": "0.2.0", "file": "x", "sha256": "0" * 64, "size": 5}).encode()}
        self.assertFalse(updater.update_check(None, opener=FakeOpener(bad), settings=self.settings, now=self.clock)["ok"])

    def test_check_never_raises_when_offline(self):
        info = updater.update_check(None, opener=FakeOpener({}), settings=self.settings, now=self.clock)
        self.assertFalse(info["ok"])
        self.assertTrue(info["error"])

    def test_error_text_carries_no_credentials(self):
        self.assertNotIn("hunter2", bg.clean("failed at https://user:hunter2@host/x"))
        self.assertNotIn("abcdef0123456789abcdef0123456789", bg.clean("key abcdef0123456789abcdef0123456789"))
        self.assertNotIn("sekret", bg.clean("Authorization: Bearer sekret12345678"))


class SignatureTests(Base):
    def setUp(self):
        super().setUp()
        self.openssl = shutil.which("openssl")

    def keypair(self):
        priv, pub = os.path.join(self.tmp, "k.pem"), os.path.join(self.tmp, "pub.pem")
        r = subprocess.run([self.openssl, "genpkey", "-algorithm", "ed25519", "-out", priv], capture_output=True)
        if r.returncode:
            self.skipTest("openssl without ed25519")
        subprocess.run([self.openssl, "pkey", "-in", priv, "-pubout", "-out", pub], check=True, capture_output=True)
        return priv, pub

    def sign(self, priv, data):
        import base64
        f = os.path.join(self.tmp, "data.bin")
        with open(f, "wb") as fh:
            fh.write(data)
        r = subprocess.run([self.openssl, "pkeyutl", "-sign", "-inkey", priv, "-rawin", "-in", f], capture_output=True)
        if r.returncode:
            self.skipTest("openssl cannot sign raw ed25519")
        return base64.b64encode(r.stdout)

    def test_unsigned_is_reported_honestly(self):
        routes, _ = release_routes("0.2.0")
        res = self.apply(routes)
        self.assertEqual(res["signature"], "unsigned")
        st = updater.update_status(None, settings=self.settings)
        self.assertIn("unsigned", st["signing"])
        self.assertEqual(st["last_signature"], "unsigned")

    def test_key_configured_but_release_unsigned_is_refused(self):
        _, pub = self.keypair() if self.openssl else (None, None)
        if not pub:
            self.skipTest("no openssl")
        self.settings.pubkey = pub
        routes, _ = release_routes("0.2.0")
        res = self.apply(routes)
        self.assertEqual(res["outcome"], "none")
        self.assertIn("not signed", res["blocked"])
        self.assertEqual(bg.current_version(self.prefix), "0.1.0")

    def test_valid_and_forged_signatures(self):
        if not self.openssl:
            self.skipTest("no openssl")
        priv, pub = self.keypair()
        self.settings.pubkey = pub
        tgz = make_tarball("0.2.0")
        routes, _ = release_routes("0.2.0", tar_bytes=tgz, signature=self.sign(priv, b"something else"))
        res = self.apply(routes)
        self.assertEqual(res["outcome"], "failed")
        self.assertEqual(bg.current_version(self.prefix), "0.1.0")
        routes, _ = release_routes("0.2.0", tar_bytes=tgz, signature=self.sign(priv, tgz))
        res = self.apply(routes)
        self.assertEqual(res["outcome"], "installed", res)
        self.assertEqual(res["signature"], "verified")

    def test_missing_openssl_fails_closed(self):
        self.assertFalse(updater.verify_signature(__file__, b"AAAA", os.path.join(self.tmp, "nokey.pem")))


class GuardTests(Base):
    def armed(self, new="0.2.0"):
        self.install_release(new, current=False)
        g = bg.Guard(self.prefix, self.state, clock=self.clock)
        bg.swap_link(self.prefix, "previous", "0.1.0")
        g.arm("0.1.0", new)
        bg.swap_link(self.prefix, "current", new)
        return g

    def crash_start(self, g):
        self.t[0] += 60
        return g.record_start()

    def test_crash_loop_rolls_back_and_remembers_the_bad_version(self):
        g = self.armed()
        self.assertFalse(self.crash_start(g)["rolled_back"])       # start 1 after the switch (clean arm)
        self.assertFalse(self.crash_start(g)["rolled_back"])       # crashed once
        self.assertFalse(self.crash_start(g)["rolled_back"])       # crashed twice
        info = self.crash_start(g)                                  # crashed three times
        self.assertTrue(info["rolled_back"], info)
        self.assertEqual(bg.current_version(self.prefix), "0.1.0")
        st = bg.load_state(self.state)
        self.assertEqual(st["bad"], ["0.2.0"])
        self.assertIsNone(st["pending"])
        self.assertIn("failed to start 3 times", st["rollback"]["reason"])
        self.assertEqual(self.outcomes(), ["rolled_back"])
        # the auto updater now skips that version
        routes, _ = release_routes("0.2.0")
        info = updater.update_check(None, opener=FakeOpener(routes), settings=self.settings, now=self.clock)
        self.assertFalse(info["update_available"])
        self.assertIn("rolled back", info["blocked"])

    def test_clean_stop_and_healthy_starts_are_not_failures(self):
        g = self.armed()
        self.crash_start(g)
        g.clean_stop()
        self.crash_start(g)
        g.clean_stop()
        self.crash_start(g)
        g.clean_stop()
        info = self.crash_start(g)
        self.assertFalse(info["rolled_back"])
        self.assertEqual(bg.load_state(self.state)["boot"].get("fails", 0), 0)

    def test_duplicate_start_inside_the_window_counts_once(self):
        g = self.armed()
        self.crash_start(g)
        for _ in range(5):
            self.t[0] += 1
            g.record_start()
        self.assertEqual(bg.load_state(self.state)["boot"].get("fails", 0), 0)

    def test_healthy_confirms_prunes_and_reports_success(self):
        self.install_release("0.0.5", current=False)
        g = self.armed()
        self.crash_start(g)
        done = g.record_healthy("uplink")
        self.assertEqual(done, {"from_version": "0.1.0", "to_version": "0.2.0"})
        st = bg.load_state(self.state)
        self.assertIsNone(st["pending"])
        self.assertEqual(st["last_good"], "0.2.0")
        self.assertEqual(bg.list_releases(self.prefix), ["0.1.0", "0.2.0"])        # last two kept
        self.assertEqual(self.outcomes(), ["succeeded"])
        self.assertIsNone(g.record_healthy("uplink"))                                # idempotent
        self.assertEqual(self.outcomes(), ["succeeded"])

    def test_not_healthy_in_time_triggers_rollback(self):
        g = self.armed()
        self.crash_start(g)
        self.assertEqual(g.health_tick(False)["action"], "none")
        self.t[0] += bg.HEALTHY_DEADLINE_S + 5
        res = g.health_tick(False)
        self.assertEqual(res["action"], "restart")
        self.assertEqual(bg.current_version(self.prefix), "0.1.0")

    def test_deadline_counts_from_this_boot_not_the_switch(self):
        g = self.armed()
        self.t[0] += 86400                      # device was off for a day after the switch
        g.record_start()
        self.assertEqual(g.health_tick(False)["action"], "none")

    def test_old_version_crashing_is_not_rolled_back(self):
        g = bg.Guard(self.prefix, self.state, clock=self.clock)       # 0.1.0, no pending update
        for _ in range(6):
            self.t[0] += 60
            self.assertFalse(g.record_start()["rolled_back"])

    def test_manual_rollback_and_no_previous(self):
        res = updater.update_rollback(None, settings=self.settings, now=self.clock)
        self.assertFalse(res["ok"])
        self.armed()
        res = updater.update_rollback(None, settings=self.settings, now=self.clock)
        self.assertTrue(res["ok"], res)
        self.assertEqual(res["to_version"], "0.1.0")
        self.assertEqual(res["restart_exit_code"], 75)
        self.assertEqual(bg.current_version(self.prefix), "0.1.0")
        self.assertIsNone(bg.previous_version(self.prefix))
        self.assertFalse(updater.update_rollback(None, settings=self.settings, now=self.clock)["ok"])

    def test_rollback_refuses_a_damaged_previous(self):
        self.armed()
        shutil.rmtree(bg.release_path(self.prefix, "0.1.0"))
        self.assertFalse(bg.Guard(self.prefix, self.state, clock=self.clock).rollback("test")["ok"])
        self.assertEqual(bg.current_version(self.prefix), "0.2.0")

    def test_script_entry_point(self):
        self.install_release("0.2.0", current=False)
        bg.swap_link(self.prefix, "previous", "0.1.0")
        self.assertEqual(bg.main(["arm", "--prefix", self.prefix, "--state", self.state, "--from", "0.1.0", "--to", "0.2.0"]), 0)
        bg.swap_link(self.prefix, "current", "0.2.0")
        self.assertEqual(bg.main(["pre-start", "--prefix", self.prefix, "--state", self.state]), 0)
        self.assertEqual(bg.main(["arm", "--prefix", self.prefix, "--state", self.state, "--to", "not-a-version"]), 2)
        self.assertEqual(bg.load_state(self.state)["pending"]["version"], "0.2.0")


class StateOwnershipTests(Base):
    def test_lock_that_cannot_be_opened_reads_as_busy_not_an_exception(self):
        d = os.path.join(self.tmp, "ro")
        os.makedirs(d, mode=0o500)
        self.addCleanup(os.chmod, d, 0o700)
        lk = bg.Lock(os.path.join(d, "x.lock"))
        if os.geteuid() == 0:
            self.skipTest("root ignores directory modes")
        self.assertFalse(lk.acquire())
        lk.release()                                                   # releasing a lock that was never held is harmless
        bad = bg.Lock(os.path.join(self.tmp, "no", "perm.lock"))
        os.makedirs(os.path.join(self.tmp, "no"), mode=0o000)
        self.addCleanup(os.chmod, os.path.join(self.tmp, "no"), 0o700)
        self.assertFalse(bad.acquire())

    def test_lock_does_not_follow_a_planted_symlink(self):
        target = os.path.join(self.tmp, "victim")
        open(target, "w").close()
        link = os.path.join(self.state, "update.lock")
        os.symlink(target, link)
        self.assertFalse(bg.Lock(link).acquire())

    def test_update_apply_returns_a_result_when_the_lock_file_is_unusable(self):
        link = os.path.join(self.state, "update.lock")
        os.symlink(os.path.join(self.tmp, "victim"), link)
        res = updater.update_apply(None, settings=self.settings, hazard=False, now=self.clock)
        self.assertFalse(res["ok"])
        self.assertEqual(res["outcome"], "failed")

    def test_root_written_files_take_the_state_folders_owner(self):
        calls = []
        real_geteuid, real_fchown = os.geteuid, os.fchown
        os.geteuid = lambda: 0
        os.fchown = lambda fd, u, g: calls.append((u, g))
        try:
            st = os.stat(self.state)
            real_stat = os.stat
            def fake_stat(p, *a, **k):
                s = real_stat(p, *a, **k)
                if p == self.state:
                    return os.stat_result((s.st_mode, s.st_ino, s.st_dev, s.st_nlink, 4242, 4343, s.st_size, 0, 0, 0))
                return s
            os.stat = fake_stat
            try:
                bg.atomic_write(os.path.join(self.state, "update.json"), b"{}")
                lk = bg.Lock(os.path.join(self.state, "update.state.lock"))
                self.assertTrue(lk.acquire())
                lk.release()
            finally:
                os.stat = real_stat
        finally:
            os.geteuid, os.fchown = real_geteuid, real_fchown
        self.assertEqual(calls, [(4242, 4343), (4242, 4343)])
        self.assertTrue(st)

    def test_non_root_never_chowns(self):
        calls = []
        real = os.fchown
        os.fchown = lambda *a: calls.append(a)
        try:
            bg.atomic_write(os.path.join(self.state, "update.json"), b"{}")
        finally:
            os.fchown = real
        if os.geteuid() != 0:
            self.assertEqual(calls, [])


class HealthAndScheduleTests(Base):
    def test_health_tick_uses_uplink_then_selftest(self):
        g = GuardTests.armed(self)
        g.record_start()
        status = {"uplink": {"last_ok_age_s": None, "auth_failed": False}}
        calls = []
        r = updater.health_tick(None, status, settings=self.settings, now=self.clock, selftest_fn=lambda d: calls.append(d))
        self.assertEqual(r["action"], "none")
        self.assertEqual(calls, [])                                    # too early for a self test
        updater._last_selftest["t"] = 0.0
        self.t[0] += 200
        updater.health_tick(None, status, settings=self.settings, now=self.clock, selftest_fn=lambda d: calls.append(d),
                            probe_fn=lambda: {"dns_ok": False})        # network really is down
        self.assertEqual(len(calls), 1)
        self.assertIsNone(bg.load_state(self.state)["pending"])        # confirmed by the self test
        # steady state: no more work
        calls.clear()
        self.assertTrue(updater.health_tick(None, status, settings=self.settings, now=self.clock)["healthy"])

    def _stuck_update(self):
        g = GuardTests.armed(self)
        g.record_start()
        updater._last_selftest["t"] = 0.0
        self.t[0] += 200
        return {"uplink": {"last_ok_age_s": None, "auth_failed": False}}

    def test_network_up_but_new_release_has_no_uplink_is_not_confirmed_by_selftest(self):
        status = self._stuck_update()
        calls = []
        for probe in ({"dns_ok": True, "http_status": 200}, {"dns_ok": True, "http_status": 404}, None):
            updater._last_selftest["t"] = 0.0
            r = updater.health_tick(None, status, settings=self.settings, now=self.clock, selftest_fn=lambda d: calls.append(d),
                                    probe_fn=(lambda p=probe: p))
            self.assertEqual(r["action"], "none")
        self.assertEqual(calls, [], "the self test must not even run while the network is up")
        self.assertIsNotNone(bg.load_state(self.state)["pending"])
        self.t[0] += 700                                               # deadline passes with no upload: rolled back
        updater._last_selftest["t"] = 0.0
        r = updater.health_tick(None, status, settings=self.settings, now=self.clock, probe_fn=lambda: {"dns_ok": True, "http_status": 200})
        self.assertEqual(r["action"], "restart")
        self.assertEqual(bg.current_version(self.prefix), "0.1.0")
        self.assertIn("0.2.0", bg.load_state(self.state)["bad"])

    def test_probe_that_raises_or_is_missing_never_confirms(self):
        status = self._stuck_update()

        def boom():
            raise RuntimeError("probe bug")
        updater.health_tick(None, status, settings=self.settings, now=self.clock, selftest_fn=lambda d: None, probe_fn=boom)
        self.assertIsNotNone(bg.load_state(self.state)["pending"])
        updater._last_selftest["t"] = 0.0
        updater.health_tick(None, status, settings=self.settings, now=self.clock, selftest_fn=lambda d: None)   # cfg None: no probe
        self.assertIsNotNone(bg.load_state(self.state)["pending"])

    def test_cloud_down_or_no_dns_lets_the_selftest_confirm(self):
        for probe in ({"dns_ok": False}, {"dns_ok": True, "error": "TimeoutError", "http_status": None},
                      {"dns_ok": True, "http_status": 503}):
            self.setUp()
            status = self._stuck_update()
            updater.health_tick(None, status, settings=self.settings, now=self.clock, selftest_fn=lambda d: None, probe_fn=lambda p=probe: p)
            self.assertIsNone(bg.load_state(self.state)["pending"], probe)

    def test_rejected_key_and_no_uplink_configured_still_accept_the_selftest(self):
        status = self._stuck_update()
        status["uplink"]["auth_failed"] = True                          # the release did reach the cloud; the key is the operator's problem
        updater.health_tick(None, status, settings=self.settings, now=self.clock, selftest_fn=lambda d: None, probe_fn=lambda: {"dns_ok": True, "http_status": 200})
        self.assertIsNone(bg.load_state(self.state)["pending"])
        self.setUp()
        status = self._stuck_update()
        updater.health_tick(None, status, settings=self.settings, now=self.clock, selftest_fn=lambda d: None, uplink_expected=False)
        self.assertIsNone(bg.load_state(self.state)["pending"])

    def test_network_is_down_helper(self):
        self.assertFalse(updater.network_is_down(None))
        self.assertFalse(updater.network_is_down({}))
        self.assertFalse(updater.network_is_down({"dns_ok": True, "http_status": 200}))
        self.assertTrue(updater.network_is_down({"dns_ok": False}))
        self.assertTrue(updater.network_is_down({"http_status": 502}))

    def test_uplink_ok_confirms_immediately(self):
        g = GuardTests.armed(self)
        g.record_start()
        updater.health_tick(None, {"uplink": {"last_ok_age_s": 3.0, "auth_failed": False}}, settings=self.settings, now=self.clock)
        self.assertIsNone(bg.load_state(self.state)["pending"])

    def test_auth_failed_uplink_is_not_healthy(self):
        g = GuardTests.armed(self)
        g.record_start()
        updater.health_tick(None, {"uplink": {"last_ok_age_s": 3.0, "auth_failed": True}}, settings=self.settings, now=self.clock,
                            selftest_after_s=1e9)
        self.assertIsNotNone(bg.load_state(self.state)["pending"])

    def test_auto_tick_schedules_with_jitter_then_applies(self):
        rng = random.Random(1)
        routes, _ = release_routes("0.2.0")
        op = FakeOpener(routes)
        kw = dict(opener=op, settings=self.settings, now=self.clock, rng=rng, hazard=False)
        self.assertIsNone(updater.auto_update_tick(None, **kw))              # first sight only schedules
        nxt = bg.load_state(self.state)["next_check"]
        self.assertTrue(120 <= nxt - self.t[0] <= 600)
        self.assertEqual(op.hits, [])
        self.assertIsNone(updater.auto_update_tick(None, **kw))              # not due
        self.t[0] = nxt + 1
        # interval is the default 6 hours with at most 20 percent jitter
        res = updater.auto_update_tick(None, **kw)
        self.assertEqual(res["outcome"], "installed", res)
        gap = bg.load_state(self.state)["next_check"] - self.t[0]
        self.assertTrue(6 * 3600 * 0.8 <= gap <= 6 * 3600 * 1.2)

    def test_auto_tick_waits_out_a_hazard(self):
        routes, _ = release_routes("0.2.0")
        kw = dict(opener=FakeOpener(routes), settings=self.settings, now=self.clock, rng=random.Random(2))
        updater.auto_update_tick(None, hazard=True, **kw)
        self.t[0] += 700
        res = updater.auto_update_tick(None, hazard=True, **kw)
        self.assertEqual(res["outcome"], "deferred")
        self.assertEqual(bg.current_version(self.prefix), "0.1.0")
        self.assertEqual(bg.load_state(self.state)["next_check"], self.t[0] + updater.HAZARD_RETRY_S)

    def test_auto_apply_off_only_checks(self):
        self.settings.auto_apply = False
        routes, _ = release_routes("0.2.0")
        kw = dict(opener=FakeOpener(routes), settings=self.settings, now=self.clock, rng=random.Random(3), hazard=False)
        updater.auto_update_tick(None, **kw)
        self.t[0] += 700
        res = updater.auto_update_tick(None, **kw)
        self.assertTrue(res["update_available"])
        self.assertEqual(bg.current_version(self.prefix), "0.1.0")

    def test_settings_clamp_interval_and_channel(self):
        os.environ["HB_UPDATE_INTERVAL_S"] = "10"
        os.environ["HB_UPDATE_CHANNEL"] = "Bad Channel!"
        try:
            s = updater.Settings.load(None, prefix=self.prefix, conf_path=os.path.join(self.tmp, "none.toml"))
        finally:
            del os.environ["HB_UPDATE_INTERVAL_S"], os.environ["HB_UPDATE_CHANNEL"]
        self.assertEqual(s.interval_s, updater.MIN_INTERVAL_S)
        self.assertEqual(s.channel, "stable")

    def test_outbox_flush_keeps_events_if_push_fails(self):
        bg.emit(self.state, "failed", reason="x", from_version="0.1.0", to_version="0.2.0")
        bg.emit(self.state, "started", from_version="0.1.0", to_version="0.2.0")
        def boom(t, d):
            raise RuntimeError("queue full")
        self.assertEqual(bg.flush_outbox(self.state, boom), 0)
        got = []
        self.assertEqual(bg.flush_outbox(self.state, lambda t, d: got.append((t, d))), 2)
        self.assertEqual(got[0][0], "agent.update")
        self.assertEqual(got[0][1]["outcome"], "failed")
        self.assertEqual(self.outbox(), [])

    def test_outbox_is_capped(self):
        for i in range(bg.OUTBOX_MAX + 15):
            bg.emit(self.state, "failed", reason=str(i))
        self.assertEqual(len(self.outbox()), bg.OUTBOX_MAX)

    def test_status_shape(self):
        st = updater.update_status(None, settings=self.settings)
        for k in ("current", "previous", "pending", "last_good", "channel", "signing", "bad_versions", "releases", "update_running"):
            self.assertIn(k, st)
        self.assertEqual(st["current"], "0.1.0")


if __name__ == "__main__":
    unittest.main()
