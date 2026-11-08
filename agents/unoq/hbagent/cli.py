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

from . import VERSION, commands, config, live, mcu, power, protocol, servers, updater
from .agent import Agent
from .store import Store
from .uplink import Api

DEFAULT_CONFIG = "/etc/homebeacon/unoq.toml"


def _cfg(args) -> config.Config:
    path = getattr(args, "config", None) or (DEFAULT_CONFIG if os.path.exists(DEFAULT_CONFIG) else None)
    cfg = config.load(path)
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
    api = None
    if key and cfg.device_id:
        api = Api(cfg.base_url, key, cfg.http_timeout_s)
    else:
        logging.getLogger("hbagent").warning("Running local-only: %s", "uplink disabled" if args.no_uplink else
                                             "set api.device_id and the device key to enable the uplink")
    source = mcu.make(cfg.mcu_source, cfg.mcu_port, cfg.mcu_baud, args.scenario)
    agent = Agent(cfg, store, api, source)
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
        for s in (srv, ctl):
            if s:
                s.stop()
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


def cmd_status(args) -> int:
    try:
        st = live.fetch(args.url)
    except Exception:  # noqa: BLE001
        print(f"The agent is not answering at {args.url}.", file=sys.stderr)
        return 1
    print(json.dumps(st, indent=2) if args.json else live.render(st))
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
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(f"HB_DEVICE_KEY={key}\n")
    os.chmod(path, 0o600)
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
