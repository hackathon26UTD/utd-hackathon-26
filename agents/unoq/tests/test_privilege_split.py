"""Root never runs code the service user can rewrite: installer ordering, wrapper, setup helper, key file rules."""
import importlib.util
import os
import re
import shutil
import stat
import subprocess
import tempfile
import unittest
from unittest import mock

from hbagent import doctor

PKG = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "packaging")


def read(name):
    with open(os.path.join(PKG, name), encoding="utf-8") as f:
        return f.read()


def load_setup_key():
    spec = importlib.util.spec_from_file_location("setup_key", os.path.join(PKG, "setup_key.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.sh = read("install.sh")

    def test_installer_is_valid_sh(self):
        self.assertEqual(subprocess.run(["sh", "-n", os.path.join(PKG, "install.sh")]).returncode, 0)

    def test_root_never_runs_python_from_the_prefix_or_release_after_the_chown(self):
        chown_at = self.sh.index('chown -R homebeacon:homebeacon "$DEST"')
        wrapper_at = self.sh.index("cat > /usr/local/bin/homebeacon-unoq.new")
        wrapper_end = self.sh.index("\nEOF\n", wrapper_at)
        after = self.sh[chown_at:wrapper_at] + self.sh[wrapper_end:]       # the wrapper text is data, not run by the installer
        for m in re.finditer(r'python3[^\n]*', after):
            self.assertNotIn("$DEST", m.group(0), m.group(0))
            self.assertNotIn("$PREFIX", m.group(0).replace("--prefix \"$PREFIX\"", ""), m.group(0))
        self.assertNotIn('"$DEST/hbagent/bootguard.py" arm', self.sh)
        self.assertIn('as_service /usr/bin/python3 -I -B "$LIBEXEC/bootguard.py" arm', self.sh)

    def test_root_copies_helpers_before_handing_the_tree_over(self):
        copy_at = self.sh.index('install -m 644 -o root -g root "$DEST.new/$f"')
        self.assertLess(copy_at, self.sh.index('mv "$DEST.new" "$DEST"'))
        self.assertLess(copy_at, self.sh.index('chown -R homebeacon:homebeacon "$DEST"'))

    def test_root_files_written_to_etc_come_from_the_root_copy(self):
        self.assertNotIn('"$DEST/packaging/', self.sh)
        self.assertIn('"$TMP/homebeacon-unoq.service"', self.sh)
        self.assertIn('"$TMP/unoq.example.toml"', self.sh)

    def test_key_file_is_group_readable_by_the_service_only(self):
        self.assertIn('chown root:homebeacon "$CONF/unoq.env"; chmod 640 "$CONF/unoq.env"', self.sh)

    def test_lock_and_state_belong_to_the_service_user(self):
        self.assertIn('chown homebeacon:homebeacon "$STATE/update.lock"', self.sh)
        self.assertLess(self.sh.index('chown -R homebeacon:homebeacon "$STATE"'), self.sh.index("arm --prefix"))

    def test_unit_runs_the_guard_from_the_root_owned_copy(self):
        unit = read("homebeacon-unoq.service")
        self.assertIn("/usr/local/libexec/homebeacon-unoq/bootguard.py pre-start", unit)
        self.assertNotIn("/opt/homebeacon-unoq/bootguard.py", unit)


class WrapperTests(unittest.TestCase):
    """Render the wrapper the installer writes and run it with a fake id, setpriv and python."""

    def render(self):
        sh = read("install.sh")
        body = sh.split("cat > /usr/local/bin/homebeacon-unoq.new <<EOF\n", 1)[1].split("\nEOF\n", 1)[0]
        body = body.replace("\\$", "$").replace("$PREFIX", "/opt/hb").replace("$CONF", "/etc/hb").replace("$LIBEXEC", "/lib/hb")
        return body + "\n"

    def run_wrapper(self, uid, args):
        d = tempfile.mkdtemp(prefix="hbwrap-")
        self.addCleanup(shutil.rmtree, d, True)
        bindir = os.path.join(d, "bin")
        os.makedirs(bindir)

        def tool(name, text):
            p = os.path.join(bindir, name)
            with open(p, "w") as f:
                f.write("#!/bin/sh\n" + text)
            os.chmod(p, 0o755)
        tool("id", f'echo {uid}\n')
        tool("setpriv", 'echo "setpriv $*"\n')
        tool("runuser", 'echo "runuser $*"\n')
        script = os.path.join(d, "wrapper")
        text = self.render().replace("/usr/bin/python3", "python3-fake")
        with open(script, "w") as f:
            f.write(text)
        env = {"PATH": bindir + ":/usr/bin:/bin"}
        r = subprocess.run(["sh", script, *args], capture_output=True, text=True, env=env)
        return r

    def test_root_setup_uses_the_root_owned_helper(self):
        r = self.run_wrapper(0, ["setup"])
        self.assertNotIn("/opt/hb", r.stdout + r.stderr)

    def test_root_everything_else_drops_to_the_service_user_first(self):
        for cmd in ("update", "doctor", "support-bundle"):
            r = self.run_wrapper(0, [cmd])
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertTrue(r.stdout.startswith("setpriv --reuid=homebeacon --regid=homebeacon --init-groups"), r.stdout)
            self.assertIn(f"/opt/hb/current/run_agent.py --config /etc/hb/unoq.toml {cmd}", r.stdout)

    def test_non_root_runs_directly(self):
        sh = self.render()
        self.assertTrue(re.search(r'\nexec python3-fake|\nexec /usr/bin/python3 -I -B /opt/hb/current/run_agent.py', sh))

    def test_setup_is_never_run_from_the_prefix_as_root(self):
        sh = self.render()
        setup_line = [ln for ln in sh.splitlines() if "setup_key.py" in ln][0]
        self.assertIn("/lib/hb/setup_key.py", setup_line)
        self.assertNotIn("/opt/hb", setup_line)


class SetupKeyTests(unittest.TestCase):
    def setUp(self):
        self.mod = load_setup_key()
        self.d = tempfile.mkdtemp(prefix="hbsetup-")
        self.addCleanup(shutil.rmtree, self.d, True)

    def test_key_validation(self):
        self.assertTrue(self.mod.valid("dk_" + "a" * 20))
        for bad in ("", "short", "has space in it1", "new\nline12345", "x" * 300, "é" * 12):
            self.assertFalse(self.mod.valid(bad), repr(bad))

    def test_write_is_atomic_private_and_contains_only_the_key_line(self):
        path = os.path.join(self.d, "unoq.env")
        with open(path, "w") as f:
            f.write("old\n")
        self.mod.write_env(path, "dk_" + "b" * 20)
        with open(path) as f:
            self.assertEqual(f.read(), "HB_DEVICE_KEY=dk_" + "b" * 20 + "\n")
        mode = stat.S_IMODE(os.stat(path).st_mode)
        self.assertIn(mode, (0o600, 0o640))
        self.assertEqual(mode & 0o007, 0)
        self.assertEqual([n for n in os.listdir(self.d) if n.startswith(".tmp-")], [])

    def test_refuses_to_run_without_root_and_never_takes_the_key_as_an_argument(self):
        with mock.patch.object(self.mod.os, "geteuid", return_value=1000):
            self.assertEqual(self.mod.main([]), 1)
        self.assertEqual(self.mod.main(["dk_secretvalue"]), 2)

    def test_does_not_echo_the_key(self):
        path = os.path.join(self.d, "unoq.env")
        with mock.patch.object(self.mod.os, "geteuid", return_value=0), \
                mock.patch.object(self.mod.getpass, "getpass", return_value="dk_" + "c" * 20), \
                mock.patch.object(self.mod.os, "chown"), \
                mock.patch("builtins.print") as pr:
            self.assertEqual(self.mod.main(["--env-file", path]), 0)
        self.assertNotIn("c" * 20, " ".join(str(a) for c in pr.call_args_list for a in c.args))


class KeyFileRuleTests(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp(prefix="hbkey-")
        self.addCleanup(shutil.rmtree, self.d, True)
        self.path = os.path.join(self.d, "unoq.env")
        with open(self.path, "w") as f:
            f.write("HB_DEVICE_KEY=dk_" + "d" * 20 + "\n")

    def cfg(self):
        return type("C", (), {"key_env": "HB_TEST_NO_SUCH_ENV", "key_file": ""})()

    def problem(self, mode, group_is_service):
        os.chmod(self.path, mode)
        with mock.patch.object(doctor, "_group_is_service", return_value=group_is_service):
            return doctor.find_key(self.cfg(), self.path)[3]

    def test_owner_only_is_fine(self):
        self.assertEqual(self.problem(0o600, False), "")

    def test_service_group_read_is_fine_other_groups_are_not(self):
        self.assertEqual(self.problem(0o640, True), "")
        self.assertIn("can be read by other users", self.problem(0o640, False))

    def test_group_write_and_world_access_are_always_a_problem(self):
        for mode in (0o660, 0o644, 0o604, 0o670):
            self.assertTrue(self.problem(mode, True), oct(mode))


if __name__ == "__main__":
    unittest.main()
