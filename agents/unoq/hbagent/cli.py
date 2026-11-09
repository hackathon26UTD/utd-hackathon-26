"""Command line entry point: `homebeacon-unoq <command>` or `python3 -m hbagent <command>`."""
from __future__ import annotations

import argparse
import json
import logging
import logging.handlers
import os
import signal
import sys
import tempfile
import time
from typing import Optional

from . import VERSION, commands, config, doctor, lifecycle, live, mcu, power, protocol, servers, support, updater, watchdog
from .agent import Agent
from .store import PRIO_STATUS, Store
from .uplink import Api

DEFAULT_CONFIG = "/etc/homebeacon/unoq.toml"


def _cfg_path(args) -> Optional[str]:
    return getattr(args, "config", None) or (DEFAULT_CONFIG if os.path.exists(DEFAULT_CONFIG) else None)


def _cfg(args) -> config.Config:
    cfg = config.load(_cfg_path(args))
    if getattr(args, "state_dir", None):
        cfg.state_dir = args.state_dir
    return cfg


def _setup_logging(cfg: config.Config, verbose: bool) -> None:
    root = logging.getLogger()
    root.setLevel(logging.DEBUG if verbose else logging.INFO)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    if cfg.log_file:
        h: logging.Handler = logging.handlers.RotatingFileHandler(cfg.log_file, maxBytes=256_000, backupCount=2)
    else:
        h = logging.StreamHandler(sys.stderr)
    h.setFormatter(fmt)
    root.handlers[:] = [h]


# ---------------------------------------------------------------- run
def cmd_run(args) -> int:
    cfg = _cfg(args)
    if args.fake:
        cfg.mcu_source = "fake"
    if args.status_port is not None:
        cfg.status_port = args.status_port
    if args.base_url:
        cfg.base_url = args.base_url
        cfg.validate()
    if args.device_id:
        cfg.device_id = args.device_id
        cfg.validate()
    _setup_logging(cfg, args.verbose)
    os.makedirs(cfg.state_dir, mode=0o700, exist_ok=True)
    try:
        os.nice(10)       # background priority: never starve the system
    except (OSError, AttributeError):
        pass
    store = Store(os.path.join(cfg.state_dir, "agent.sqlite"), cfg.queue_rows, cfg.queue_bytes)
    key = "" if args.no_uplink else cfg.device_key()
    api = guard = wd = None
    if key and cfg.device_id:
        guard = watchdog.UplinkGuard(
            state_file=watchdog.state_path(cfg.state_dir),
            on_event=lambda etype, data: store.push("event", {"type": etype, "data": data}, PRIO_STATUS),
            critical_pending=lambda: store.stats()["critical"] > 0)
        api = Api(cfg.base_url, key, cfg.http_timeout_s, guard=guard)
        wd = watchdog.UplinkWatchdog(guard, api, store.depth)
    else:
        logging.getLogger("hbagent").warning("Running local-only: %s", "uplink disabled" if args.no_uplink else
                                             "set api.device_id and the device key to enable the uplink")
    source = mcu.make(cfg.mcu_source, cfg.mcu_port, cfg.mcu_baud, args.scenario)
    agent = Agent(cfg, store, api, source)
    if wd is not None:
        watchdog.install(agent, wd)
    life = None
    if not args.no_lifecycle:
        life = lifecycle.Lifecycle(agent, cfg, store, auto_update=api is not None).install()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: (agent.stop.set(), agent.wake.set()))
    srv = ctl = None
    if cfg.status_port:
        try:
            srv = servers.StatusServer(cfg.status_port, agent.status, lambda: agent.live.recent(100))
            srv.start()
            print(f"[agent] status on http://127.0.0.1:{srv.port}/status (read-only, loopback)", flush=True)
        except OSError as e:
            logging.getLogger("hbagent").warning("status server not started: %s", e)
    try:
        ctl = servers.ControlServer(os.path.join(cfg.state_dir, "control.sock"), agent.local_request)
        ctl.start()
    except OSError as e:
        logging.getLogger("hbagent").warning("control socket not started: %s", e)
    try:
        code = agent.run(args.max_steps)
    finally:
        if life is not None:
            life.close()
        for s in (srv, ctl):
            if s:
                s.stop()
        if guard is not None:
            guard.flush_state()
        if api is not None:
            api.close()
        store.close()
    return code


# ---------------------------------------------------------------- local bench commands
def _control(args, op: str, text: str) -> int:
    cfg = _cfg(args)
    reply = servers.send_control(os.path.join(cfg.state_dir, "control.sock"), op, text)
    if reply is None:
        print("The agent is not running here (no control socket). Start it with: homebeacon-unoq run", file=sys.stderr)
        return 1
    print(reply)
    return 0 if not reply.startswith("refused") else 2


def cmd_say(args) -> int:
    return _control(args, "say", " ".join(args.text))


def cmd_cmd(args) -> int:
    if not args.text:
        print("Allowed commands:\n" + commands.help_text())
        return 0
    return _control(args, "cmd", " ".join(args.text))


def cmd_ack(args) -> int:
    return _control(args, "ack", args.id or "")


def cmd_live(args) -> int:
    return live.run(args.url, args.interval, args.once)


def _uplink_health(args) -> Optional[dict]:
    try:
        return watchdog.read_state(watchdog.state_path(_cfg(args).state_dir))
    except (config.ConfigError, OSError):
        return None


def _uplink_lines(g: Optional[dict]) -> list:
    if not g:
        return []
    out = ["Uplink guard: " + ("KEY REJECTED, retrying every 15 minutes" if g.get("key_rejected") else str(g.get("state", "unknown")).replace("_", " "))]
    if g.get("key_rejected"):
        out.append("  " + str(g.get("message", "")))
    elif g.get("message"):
        out.append("  " + str(g["message"]))
    if g.get("last_ok_age_s") is not None:
        out.append(f"  last accepted upload {doctor._dur(g['last_ok_age_s'])} ago (as of the last agent write)")
    if g.get("heals"):
        h = g["heals"][-1]
        out.append(f"  self-heal attempts: {len(g['heals'])}; latest {h.get('action')} (network {h.get('network')})")
    return out


def cmd_status(args) -> int:
    g = _uplink_health(args)
    try:
        st = live.fetch(args.url)
    except Exception:  # noqa: BLE001
        print(f"The agent is not answering at {args.url}.", file=sys.stderr)
        for ln in _uplink_lines(g):
            print(ln, file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps({**st, "uplink_guard": g}, indent=2))
    else:
        print(live.render(st))
        for ln in _uplink_lines(g):
            print(ln)
    return 0


# ---------------------------------------------------------------- troubleshooting
def cmd_doctor(args) -> int:
    path = _cfg_path(args)
    try:
        cfg = _cfg(args)
    except config.ConfigError as e:
        checks = doctor.config_failure(str(e))
    else:
        checks = doctor.run_checks(cfg, config_path=path, env_file=args.env_file, offline=args.offline)
    if args.json:
        print(json.dumps({"exit_code": doctor.exit_code(checks), "summary": doctor.summary(checks), "checks": [c.as_dict() for c in checks]}, indent=2))
    else:
        print(doctor.render(checks))
    return doctor.exit_code(checks)


def cmd_support_bundle(args) -> int:
    cfg = _cfg(args)
    key = doctor.find_key(cfg, args.env_file)[0]
    checks = doctor.run_checks(cfg, config_path=_cfg_path(args), env_file=args.env_file, offline=args.offline)
    queue = None
    qpath = os.path.join(cfg.state_dir, "agent.sqlite")
    if os.path.exists(qpath):
        try:
            queue = doctor.read_queue_stats(qpath, time.time())
        except Exception:  # noqa: BLE001
            queue = None
    status = None
    try:
        status = live.fetch(args.url)
    except Exception:  # noqa: BLE001
        pass
    upd, _ = doctor.get_update_status(cfg)
    try:
        info = support.build_bundle(cfg, queue_stats=queue, report=[c.as_dict() for c in checks], update_status=upd, status=status,
                                    key=key, log_n=args.lines, out_dir=args.out_dir,
                                    uplink_state=watchdog.read_state(watchdog.state_path(cfg.state_dir)))
    except OSError as e:
        print(f"Could not write the support bundle: {e}", file=sys.stderr)
        return 1
    print(f"Support bundle written: {info['path']} ({info['bytes']} bytes, mode 600)")
    print("Secrets are masked and the device key is not included. Nothing was uploaded; copy it off the hub yourself if you want to share it.")
    return 0


def cmd_logs(args) -> int:
    cfg = _cfg(args)
    secrets = [k for k in (doctor.find_key(cfg, args.env_file)[0],) if k]
    src, lines = support.log_lines(cfg, args.lines, secrets)
    if not lines and not args.follow:
        print("No log lines found. The agent logs to the systemd journal unless log_file is set in the config.\n"
              "Try: journalctl -u homebeacon-unoq -n 100 --no-pager", file=sys.stderr)
        return 1
    for ln in lines:
        print(ln)
    if args.follow:
        return _follow_logs(cfg, secrets)
    return 0


def _follow_logs(cfg, secrets) -> int:
    import subprocess
    try:
        if cfg.log_file:
            with open(cfg.log_file, "r", encoding="utf-8", errors="replace") as f:
                f.seek(0, os.SEEK_END)
                inode = os.fstat(f.fileno()).st_ino
                while True:
                    line = f.readline()
                    if line:
                        print(support.mask(line.rstrip("\n")[:support.MAX_LINE], secrets), flush=True)
                        continue
                    time.sleep(1.0)
                    try:
                        if os.stat(cfg.log_file).st_ino != inode:        # rotated: reopen
                            return _follow_logs(cfg, secrets)
                    except OSError:
                        pass
        p = subprocess.Popen(["journalctl", "-u", "homebeacon-unoq", "-f", "-n", "0", "--no-pager", "-o", "short-iso"],
                             stdout=subprocess.PIPE, text=True, errors="replace")
        for line in p.stdout:                                           # type: ignore[union-attr]
            print(support.mask(line.rstrip("\n")[:support.MAX_LINE], secrets), flush=True)
    except (KeyboardInterrupt, BrokenPipeError):
        return 0
    except OSError as e:
        print(f"Cannot follow the log: {e}", file=sys.stderr)
        return 1
    return 0


def cmd_env(args) -> int:
    cfg = _cfg(args)
    key = doctor.find_key(cfg, args.env_file)[0]
    env = support.environment(cfg)
    if args.json:
        print(json.dumps(support.mask_obj(env, [key] if key else []), indent=2, sort_keys=True, default=str))
        return 0
    text = None
    try:
        from . import envreport
        fn = getattr(envreport, "render_environment_text", None)
        if fn is not None:
            text = fn(env)
    except Exception:  # noqa: BLE001
        text = None
    if not isinstance(text, str):
        text = "\n".join(f"{k}: {v}" for k, v in sorted(env.items()))
    print(support.mask(text, [key] if key else []))
    return 0


_UPDATE_FN = {"check": "update_check", "apply": "update_apply", "rollback": "update_rollback", "status": "update_status"}


def cmd_update(args) -> int:
    import inspect
    cfg = _cfg(args)
    fn = getattr(updater, _UPDATE_FN[args.action], None)
    if fn is None:
        if args.action == "check":
            args.download = False
            return cmd_check_update(args)
        print(f"`update {args.action}` is not available in this build. Use `check-update` and install.sh (see docs/UNOQ_AGENT.md).", file=sys.stderr)
        return 1
    try:
        res = fn(cfg) if inspect.signature(fn).parameters else fn()
    except updater.UpdateError as e:
        print(f"Update {args.action} failed: {support.mask(str(e))}", file=sys.stderr)
        return 1
    if isinstance(res, dict):
        print(json.dumps(support.mask_obj(res), indent=2, sort_keys=True, default=str) if args.json else
              "\n".join(f"{k}: {support.mask(str(v))}" for k, v in sorted(res.items()) if k != "manifest"))
        return 1 if (res.get("ok") is False or res.get("error")) else 0
    print(support.mask(str(res)))
    return 0


# ---------------------------------------------------------------- power
def _kv(text: str) -> dict:
    out = {}
    for part in filter(None, (text or "").split(",")):
        k, _, v = part.partition("=")
        out[k.strip()] = float(v)
    return out


def plan_from_args(a) -> dict:
    problem = power.converter_problem(a.converter, a.volts)
    if problem:
        raise config.ConfigError(f"--converter: {problem}")
    eff = power.converter_efficiency(a.converter, a.volts)
    batt = None
    if a.mah and a.volts:
        batt = power.Battery(a.mah, a.volts, a.soc, a.soc_source if a.soc is not None else "assumed", a.chemistry, eff)
    cfg = power.PowerConfig(need_hours=a.hours, last_gasp_hours=a.last_gasp_hours)
    if a.measured:
        cfg = cfg.with_measured(_kv(a.measured))
    d = power.plan(batt, cfg, a.mains, a.hazard)
    return {"decision": d, "battery": batt, "config": cfg}


def cmd_power_plan(args) -> int:
    p = plan_from_args(args)
    d, b = p["decision"], p["battery"]
    if args.json:
        out = {k: v for k, v in d.__dict__.items()}
        out["usable_wh"] = None if b is None else round(b.usable_wh(), 2)
        out["nameplate_wh"] = None if b is None else round(b.nameplate_wh(), 2)
        print(json.dumps(out, indent=2))
        return 0
    print(f"Plan for a {args.hours:g} hour outage; mains {args.mains}{', hazard active' if args.hazard else ''}")
    if b:
        print(f"Battery: {b.nameplate_wh():.1f} Wh nameplate, {b.usable_wh():.1f} Wh usable at the 5 V rail "
              f"({b.chemistry}, {b.soc_pct if b.soc_pct is not None else 100:g}% charge from {b.soc_source}, converter {int(b.converter_eff * 100)}%)")
        print(f"Reserve held back: {d.reserve_wh} Wh (larger of {int(p['config'].reserve_fraction * 100)}% or {p['config'].last_gasp_hours:g} h of beacon)")
    print(f"\n{'mode':<9}{'report':>8}{'avg mW':>9}{'hours':>8}  meets target")
    for r in d.table:
        print(f"{r['mode']:<9}{str(r['report_s']) + 's':>8}{r['avg_mw']:>9.0f}{'?' if r['hours'] is None else r['hours']:>8}  {'-' if r['meets_target'] is None else ('yes' if r['meets_target'] else 'no')}")
    print(f"\nChosen: {d.mode.upper()}, report every {d.report_s}s, message check at least every {d.poll_floor_s}s")
    print(f"Confidence: {d.confidence} (loads: {d.basis})")
    print("\n" + "\n".join(d.reasons))
    if d.assumptions:
        print("\nAssumptions:\n" + "\n".join("  - " + x for x in d.assumptions))
    print("\nAll mW figures are estimates until measured with a USB power meter (docs/POWER_DESIGN.md).")
    return 0


# ---------------------------------------------------------------- misc
def cmd_selftest(args) -> int:
    fails = []

    def check(name, cond):
        print(("PASS " if cond else "FAIL ") + name)
        if not cond:
            fails.append(name)

    check("parse HB line", protocol.parse_hb_line('HB {"box":"A","type":"reading","water":false}') is not None)
    check("reject bad box id", protocol.parse_hb_line('HB {"box":"bad id"}') is None)
    check("command allowlist rejects shell", _rejects("poll 60; rm -rf /"))
    d = power.plan(power.Battery(5000, 3.7, 100, "manual", "liion", 0.88), power.PowerConfig(), "lost")
    check("power plan chooses a mode", d.mode in power.MODES and d.hours_remaining is not None)
    with tempfile.TemporaryDirectory() as td:
        s = Store(os.path.join(td, "q.sqlite"), max_rows=3)
        for i in range(5):
            s.push("event", {"type": "x", "data": {"i": i}})
        check("queue is bounded", s.depth() == 3)
        s.close()
    print("selftest " + ("PASS" if not fails else "FAIL"))
    return 1 if fails else 0


def _rejects(text: str) -> bool:
    try:
        commands.parse(text)
    except commands.CommandError:
        return True
    return False


def cmd_version(args) -> int:
    print(VERSION)
    return 0


def cmd_check_update(args) -> int:
    cfg = _cfg(args)
    base = cfg.update_base or cfg.base_url
    try:
        if args.download:
            info = updater.download(base, os.path.join(cfg.state_dir, "updates"))
        else:
            info = updater.check(base)
    except updater.UpdateError as e:
        print(f"Update check failed: {e}", file=sys.stderr)
        return 1
    print(f"Current {info['current']}, latest {info['latest']}. {info['note']}")
    if info.get("staged"):
        print(f"Verified and saved: {info['staged']}\nTo install: {info['install_command']}")
    elif info["update_available"]:
        print("Run again with --download to fetch and verify it. Nothing is installed automatically.")
    return 0


def cmd_config_example(args) -> int:
    sys.stdout.write(config.EXAMPLE)
    return 0


def cmd_setup(args) -> int:
    """Store the device key in a mode 600 env file. The key is typed here, never passed on a command line."""
    import getpass
    path = args.env_file
    key = getpass.getpass("Paste the device key (input hidden): ").strip()
    if not key or len(key) < 8:
        print("No key entered.", file=sys.stderr)
        return 1
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(f"HB_DEVICE_KEY={key}\n")
        os.chmod(path, 0o600)
    except PermissionError:
        print(f"Cannot write {path} as this user. Run: sudo homebeacon-unoq setup", file=sys.stderr)
        return 1
    print(f"Saved to {path} (mode 600). Restart the service: sudo systemctl restart homebeacon-unoq")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="homebeacon-unoq", description="HomeBeacon Uno Q agent")
    p.add_argument("--config", help=f"TOML config (default {DEFAULT_CONFIG} if present)")
    p.add_argument("--state-dir", help="override agent.state_dir")
    sub = p.add_subparsers(dest="command", required=True)

    r = sub.add_parser("run", help="run the agent")
    r.add_argument("--fake", action="store_true", help="use the fake MCU (no hardware)")
    r.add_argument("--scenario", default="quiet", choices=["quiet", "flood", "outage", "mixed"])
    r.add_argument("--no-uplink", action="store_true")
    r.add_argument("--no-lifecycle", action="store_true", help="do not run self-update, boot guard or environment report")
    r.add_argument("--status-port", type=int)
    r.add_argument("--base-url")
    r.add_argument("--device-id")
    r.add_argument("--max-steps", type=int, help=argparse.SUPPRESS)
    r.add_argument("-v", "--verbose", action="store_true")
    r.set_defaults(fn=cmd_run)

    for name, fn, hlp in (("live", cmd_live, "live terminal view"), ("status", cmd_status, "print current status")):
        s = sub.add_parser(name, help=hlp)
        s.add_argument("--url", default="http://127.0.0.1:8765")
        s.add_argument("--interval", type=float, default=2.0)
        s.add_argument("--once", action="store_true")
        s.add_argument("--json", action="store_true")
        s.set_defaults(fn=fn)

    s = sub.add_parser("say", help="show a local note on the hub (bench)")
    s.add_argument("text", nargs="+")
    s.set_defaults(fn=cmd_say)
    s = sub.add_parser("cmd", help="run an allowlisted control command locally (bench); no args lists them")
    s.add_argument("text", nargs="*")
    s.set_defaults(fn=cmd_cmd)
    s = sub.add_parser("ack", help="acknowledge the latest message that needs it")
    s.add_argument("id", nargs="?")
    s.set_defaults(fn=cmd_ack)

    s = sub.add_parser("power-plan", help="print the runtime plan for a battery")
    s.add_argument("--mah", type=float, default=0, help="nameplate capacity")
    s.add_argument("--volts", type=float, default=0, help="pack nominal volts at the converter input")
    s.add_argument("--soc", type=float, help="state of charge percent")
    s.add_argument("--soc-source", default="manual", choices=["gauge", "manual", "voltage_estimate", "assumed"])
    s.add_argument("--chemistry", default="unknown", choices=list(power.CHEMISTRY_DERATE))
    s.add_argument("--converter", default="buck", choices=["buck", "ldo", "boost"])
    s.add_argument("--hours", type=float, default=24)
    s.add_argument("--last-gasp-hours", type=float, default=2)
    s.add_argument("--mains", default="lost", choices=["present", "lost", "unknown"])
    s.add_argument("--hazard", action="store_true")
    s.add_argument("--measured", help="USB-meter averages in mW, e.g. full=2400,beacon=1100")
    s.add_argument("--json", action="store_true")
    s.set_defaults(fn=cmd_power_plan)

    for name, fn, hlp in (("selftest", cmd_selftest, "offline self test"), ("version", cmd_version, "print version"),
                          ("config-example", cmd_config_example, "print an example config")):
        sub.add_parser(name, help=hlp).set_defaults(fn=fn)
    s = sub.add_parser("check-update", help="look for a checksummed release (never installs)")
    s.add_argument("--download", action="store_true", help="fetch and verify the tarball into the state dir")
    s.set_defaults(fn=cmd_check_update)
    s = sub.add_parser("doctor", help="check the hub end to end and say how to fix each problem (exit 0 ok, 1 warn, 2 fail)")
    s.add_argument("--json", action="store_true")
    s.add_argument("--offline", action="store_true", help="skip the checks that use the network")
    s.add_argument("--env-file", default=doctor.DEFAULT_ENV_FILE)
    s.set_defaults(fn=cmd_doctor)
    s = sub.add_parser("support-bundle", help="write a redacted .tar.gz for support (local file, never uploaded)")
    s.add_argument("--lines", type=int, default=support.LOG_LINES_DEFAULT, help="log lines to include")
    s.add_argument("--out-dir", help="default <state_dir>/support")
    s.add_argument("--offline", action="store_true")
    s.add_argument("--url", default="http://127.0.0.1:8765")
    s.add_argument("--env-file", default=doctor.DEFAULT_ENV_FILE)
    s.set_defaults(fn=cmd_support_bundle)
    s = sub.add_parser("logs", help="show the agent log with secrets masked")
    s.add_argument("-n", "--lines", type=int, default=100)
    s.add_argument("-f", "--follow", action="store_true")
    s.add_argument("--env-file", default=doctor.DEFAULT_ENV_FILE)
    s.set_defaults(fn=cmd_logs)
    s = sub.add_parser("env", help="print what the hub knows about its own environment")
    s.add_argument("--json", action="store_true")
    s.add_argument("--env-file", default=doctor.DEFAULT_ENV_FILE)
    s.set_defaults(fn=cmd_env)
    s = sub.add_parser("update", help="check, apply or roll back an agent update; or show update status")
    s.add_argument("action", choices=list(_UPDATE_FN))
    s.add_argument("--json", action="store_true")
    s.set_defaults(fn=cmd_update)
    s = sub.add_parser("setup", help="store the device key in a mode 600 file")
    s.add_argument("--env-file", default="/etc/homebeacon/unoq.env")
    s.set_defaults(fn=cmd_setup)
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.fn(args)
    except config.ConfigError as e:
        print(f"Config problem: {e}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        return 130
