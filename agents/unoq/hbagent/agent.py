"""The agent loop. One main thread sleeps on an Event until the next deadline; no busy loops.

Threads: main loop, MCU reader (blocks in select), status HTTP server, local control socket.
Everything the other threads want done is handed over through small bounded queues.

Never overloaded by design:
  - uplink is batched (at most `max_requests_per_flush` requests per wake, 50 readings per batch)
  - the offline queue, ring buffer, inbox and log file all have hard caps
  - failed sends back off with jitter and respect the power mode's Wi-Fi retry floor
  - hazards bypass the schedule but not a 15 second minimum gap between network attempts
"""
from __future__ import annotations

import collections
import logging
import random
import threading
import time
from typing import Callable, Optional

from . import VERSION, commands, power, protocol, system
from .config import Config
from .store import PRIO_CRITICAL, PRIO_ROUTINE, PRIO_STATUS, Store
from .uplink import Api, Backoff

log = logging.getLogger("hbagent")
MIN_URGENT_GAP_S = 15.0
POWER_EVERY_S = 30.0
HAZARD_REPEAT_S = 60.0
BATCH_READINGS = 50
SERVER_POLL_DEFAULT = 30


class Agent:
    def __init__(self, cfg: Config, store: Store, api: Optional[Api], source, *, wall: Callable[[], float] = time.time,
                 mono: Callable[[], float] = time.monotonic, rng: Optional[random.Random] = None,
                 sysinfo: Callable[[], dict] = system.sample, battery_reader: Optional[Callable] = None):
        self.cfg, self.store, self.api, self.source = cfg, store, api, source
        self.wall, self.mono = wall, mono
        self.rng = rng or random.Random()
        self.sysinfo = sysinfo
        self.battery_reader = battery_reader or (lambda: system.read_battery(cfg.power_source, cfg, wall()))
        self.live = protocol.LiveState()
        self.boot = store.next_boot()
        self.seq = protocol.Sequencer(cfg.device_id or "0" * 24, self.boot)
        self.pcfg = cfg.power_config()
        self.stop = threading.Event()
        self.wake = threading.Event()
        self.exit_code = 0
        self._inq: collections.deque = collections.deque(maxlen=500)
        self._ctl: collections.deque = collections.deque(maxlen=50)
        self.gauges: collections.deque = collections.deque(maxlen=120)
        self.backoff = Backoff(rng=self.rng)
        t = mono()
        self.t_start = t
        self.next_sample = self.next_report = self.next_poll = self.next_power = self.next_net = t
        self.last_net_try = -1e9
        self.ladder = power.LadderState()
        self.decision: Optional[power.Decision] = None
        self.mode_override: Optional[tuple] = None   # (mode, until_mono)
        self.poll_override: Optional[tuple] = None   # (seconds, until_mono)
        self.settings_poll: Optional[int] = None
        self.server_poll = SERVER_POLL_DEFAULT
        self.unreported_rev: Optional[tuple] = None
        self.muted = False
        self.identify_until = 0.0
        self.auth_failed = False
        self.beacon_disabled_until = 0.0
        self.beacon_hold_until = 0.0     # monotonic: beacon rows are not retried before this (a 409 keeps them queued)
        self.last_ok: Optional[float] = None
        self.battery = None
        self.batt = None                 # the battery model the power decision used (carries the charge source)
        # Energy counted while off mains with no gauge. Reset when the entered starting charge changes.
        saved_start = store.get("used_wh_start", "unset")
        if saved_start != "unset" and saved_start != cfg.assumed_soc_pct:
            store.put("used_wh", 0.0)
        store.put("used_wh_start", cfg.assumed_soc_pct)
        self.used_wh = float(store.get("used_wh", 0.0))
        self._power_t: Optional[float] = None
        self._used_saved = t
        self.hazard_state = (False, [])
        self.haz_last: dict = {}
        self.mains_observed = "unknown"
        self.last_gasp_sent = False
        self.counters = {"sent": 0, "retries": 0, "rejected": 0, "conflicts": 0, "commands": 0, "commands_refused": 0, "polls": 0}
        self.last_error = ""
        self.urgent = False
        self.cursor = int(store.get("cursor", 0))
        self.settings_rev = store.get("settings_rev", None)

    # ------------------------------------------------------------ thread-safe entry points
    def on_mcu(self, msg: dict) -> None:
        self._inq.append((self.mono(), msg))
        if protocol.hazards_in(msg):
            self.wake.set()

    def local_request(self, op: str, text: str) -> str:
        """Called from the control socket thread. Validates now, executes on the main thread."""
        if op == "say":
            self._ctl.append(("say", text[:200]))
            self.wake.set()
            return "shown on the hub"
        if op == "cmd":
            try:
                cmd = commands.parse(text, allow_reboot=self.cfg.allow_reboot_agent)
            except commands.CommandError as e:
                return f"refused: {e}"
            self._ctl.append(("cmd", cmd))
            self.wake.set()
            return f"accepted: {cmd.text()}"
        if op == "ack":
            self._ctl.append(("ack", text[:40]))
            self.wake.set()
            return "ack queued"
        return "refused: unknown operation"

    # ------------------------------------------------------------ helpers
    def say(self, text: str, level: int = logging.INFO) -> None:
        self.live.inbox.append({"at": round(self.wall()), "text": text[:120]})
        log.log(level, "%s", text)
        if not self.muted and level >= logging.INFO:
            print(f"[hub] {text}", flush=True)

    def _enqueue(self, kind: str, body: dict, prio: int, eid: Optional[str] = None) -> None:
        if not self.api:
            return      # local-only run: nothing to deliver, so nothing to queue
        self.store.push(kind, body, prio, eid, self.wall())

    def _event(self, etype: str, data: dict, prio: int = PRIO_STATUS) -> None:
        self._enqueue("event", {"type": etype, "data": data}, prio)

    def _poll_seconds(self) -> int:
        now = self.mono()
        want = self.server_poll
        if self.settings_poll:
            want = self.settings_poll
        if self.poll_override and self.poll_override[1] > now:
            want = self.poll_override[0]
        d = self.decision
        if d is None or d.mode == "full" or d.hazard_boost:
            floor = commands.POLL_MIN
        else:
            floor = d.poll_floor_s
        return int(min(max(want, floor), 900))

    # ------------------------------------------------------------ main loop
    def run(self, max_steps: Optional[int] = None) -> int:
        log.info("agent %s starting, boot %d", VERSION, self.boot)
        self.source.start(self.on_mcu, self.stop)
        steps = 0
        while not self.stop.is_set():
            delay = self.step()
            steps += 1
            if max_steps is not None and steps >= max_steps:
                break
            self.wake.wait(delay)
            self.wake.clear()
        self.shutdown()
        return self.exit_code

    def shutdown(self) -> None:
        try:
            self.store.put("used_wh", round(self.used_wh, 4))
        except Exception:  # noqa: BLE001
            log.exception("could not save the energy counter")
        try:
            self._flush(self.mono(), force=True, limit=2)
        except Exception:  # noqa: BLE001
            log.exception("final flush failed")

    def step(self) -> float:
        now = self.mono()
        self._drain(now)
        self._controls(now)
        if now >= self.next_power or self._hazard_changed(now):
            self._power(now)
        if now >= self.next_sample:
            self._sample(now)
        if now >= self.next_report:
            self._report(now)
        if self.api and (now >= self.next_net or self.urgent):
            self._flush(now)
        if self.api and now >= self.next_poll and now >= self.next_net_poll_ok():
            self._poll(now)
        # A poll that is waiting out a network backoff is not due yet. Without this the loop woke at 5 Hz
        # for the whole outage. With no API at all there is no poll to wait for.
        polls = max(self.next_poll, self.next_net_poll_ok()) if self.api else float("inf")
        due = min(self.next_sample, self.next_report, polls, self.next_power)
        if self.store.depth() and self.api:
            due = min(due, max(self.next_net, now + 1.0))
        return max(1.0, min(5.0, due - self.mono()))

    def next_net_poll_ok(self) -> float:
        return self.next_net if self.backoff.n else 0.0

    # ------------------------------------------------------------ inputs
    def _drain(self, now: float) -> None:
        wall = self.wall()
        while self._inq:
            t, msg = self._inq.popleft()
            found = self.live.ingest(msg, t)
            fresh = [h for h in found if t - self.haz_last.get(f"{msg['box']}:{h}", -1e9) >= HAZARD_REPEAT_S]
            for h in found:
                if h in fresh:
                    self.haz_last[f"{msg['box']}:{h}"] = t
            if fresh:     # report a hazard when it is new or 60 s old, not once per sensor reading
                self._event("hub.hazard_seen", {"box": msg["box"], "reasons": fresh[:5], "event": str(msg.get("event", ""))[:24]}, PRIO_CRITICAL)
                self.urgent = True
                self.say(f"Hazard reported by box {msg['box']}: {', '.join(fresh[:3])}", logging.WARNING)
            wf = self.cfg.relay_water_from
            if wf and msg["box"] == wf and isinstance(msg.get("water"), bool) and msg.get("type") == "reading":
                self._push_beacon(wall, water=msg["water"], prio=PRIO_CRITICAL if msg["water"] else PRIO_ROUTINE)
                self.urgent = self.urgent or msg["water"]

    def _controls(self, now: float) -> None:
        while self._ctl:
            op, arg = self._ctl.popleft()
            if op == "say":
                self.say(f"Local note: {arg}")
            elif op == "cmd":
                self._exec(arg, "local")
            elif op == "ack":
                self._local_ack(arg)

    def _hazard_changed(self, now: float) -> bool:
        h = self.live.hazard(now)
        changed = h[0] != self.hazard_state[0]
        self.hazard_state = h
        return changed

    # ------------------------------------------------------------ power
    def _power(self, now: float) -> None:
        br = self.battery_reader()
        self.battery = br
        mains = self.live.mains(now)
        if mains == "unknown" and br.mains is not None:
            mains = "present" if br.mains else "lost"
        self.mains_observed = mains           # only real observations are ever reported to the cloud
        if mains == "unknown" and self.cfg.assume_mains != "unknown":
            mains = self.cfg.assume_mains     # an assumption steers local power use, nothing else
        self._count_energy(now, mains, br)
        batt = self.cfg.battery(br.soc_pct, br.soc_source, self.used_wh)
        self.batt = batt
        ov = self.mode_override
        active = bool(ov and ov[1] > now and ov[0] in power.MODES)
        if ov and ov[1] <= now:
            self.mode_override = None
        inp = power.PowerInputs(batt, mains, self.hazard_state[0], ov[0] if active else None, active)
        dec, self.ladder = power.decide(inp, self.ladder, now, self.pcfg)
        prev = self.decision
        self.decision = dec
        self.next_power = now + POWER_EVERY_S
        if dec.changed or prev is None:
            self.say(f"Power mode {dec.mode}. {dec.reasons[0] if dec.reasons else ''}")
            self._event("agent.mode", {"mode": dec.mode, "server_mode": dec.server_mode, "report_s": dec.report_s,
                                       "hours": dec.hours_remaining, "confidence": dec.confidence,
                                       "why": " ".join(dec.reasons)[:200]})
            self.next_report = min(self.next_report, now + min(dec.report_s, 5))
        if dec.last_gasp_active and not self.last_gasp_sent:
            self.last_gasp_sent = True
            self._event("agent.last_gasp", {"reserve_wh": dec.reserve_wh, "mode": dec.mode}, PRIO_CRITICAL)
            self._push_status(self.wall(), PRIO_CRITICAL)
            self.urgent = True
            self.say("Battery is at the last-gasp reserve. Final status queued; only the heartbeat continues.", logging.WARNING)
        elif not dec.last_gasp_active:
            self.last_gasp_sent = False

    def _count_energy(self, now: float, mains: str, br) -> None:
        """Without a gauge the charge is a starting figure, so count the energy used instead of holding it still.

        Runs only off mains (unknown counts as off) and only when no gauge or voltage reading gave a charge.
        Uses the average draw of the mode that was running. Persisted every five minutes and at shutdown.
        """
        last, self._power_t = self._power_t, now
        d = self.decision
        if last is None or d is None or br.soc_pct is not None or mains == "present":
            return
        dt = min(max(0.0, now - last), 120.0)
        self.used_wh += d.avg_mw * dt / 3.6e6
        if now - self._used_saved >= 300.0:
            self._used_saved = now
            self.store.put("used_wh", round(self.used_wh, 4))

    def _sample(self, now: float) -> None:
        s = self.sysinfo()
        s["t"] = round(self.wall())
        self.gauges.append(s)
        self.next_sample = now + (self.decision.sample_s if self.decision else 30)

    # ------------------------------------------------------------ reporting
    def _push_beacon(self, wall: float, *, water=None, prio: int = PRIO_ROUTINE) -> None:
        if not self.cfg.device_id or self.wall() < self.beacon_disabled_until or not self.api:
            return
        mains_v = self.live.mains(self.mono())
        if mains_v == "unknown":
            mains_v = self.mains_observed
        mains_b = True if mains_v == "present" else False if mains_v == "lost" else None
        soc = self.battery.soc_pct if self.battery and self.battery.soc_source == "gauge" else None
        eid, seq = self.seq.next()
        body = protocol.beacon_payload(self.cfg.device_id, eid, seq, wall, mains=mains_b if self.cfg.relay_mains else None,
                                       battery_pct=soc, water=water)
        if body:
            self._enqueue("beacon", body, prio, eid)

    def _push_status(self, wall: float, prio: int = PRIO_STATUS) -> None:
        d = self.decision
        if d is None:
            return
        lean = d.mode in ("survival", "beacon") and not d.hazard_boost
        r = [protocol.reading("power_mode", d.server_mode, None, wall), protocol.reading("agent_mode", d.mode, None, wall)]
        if d.hours_remaining is not None:
            r.append(protocol.reading("runway_h", d.hours_remaining, "h", wall))
        if not lean:
            r.append(protocol.reading("load_mw_est", d.avg_mw, "mW", wall))
            if self.battery and self.battery.soc_pct is not None:
                r.append(protocol.reading("soc_pct", round(self.battery.soc_pct, 1), "%", wall))
            g = self.gauges[-1] if self.gauges else {}
            if "cpu_temp_c" in g:
                r.append(protocol.reading("cpu_temp_c", g["cpu_temp_c"], "C", wall))
            r.append(protocol.reading("queue_depth", self.store.depth(), None, wall))
            # 1 only when a hazard is latched. 0 only when a box was heard recently and none is latched.
            # No data (MCU unplugged, every box stale, just restarted) sends nothing: unknown, not "no hazard".
            if self.hazard_state[0]:
                r.append(protocol.reading("hazard_active", 1, None, wall))
            elif self.live.fresh_any(self.mono()):
                r.append(protocol.reading("hazard_active", 0, None, wall))
        self._enqueue("ingest", {"readings": r}, prio)

    def _report(self, now: float) -> None:
        wall = self.wall()
        self._push_beacon(wall)
        self._push_status(wall, PRIO_STATUS if self.hazard_state[0] else PRIO_ROUTINE)
        self.next_report = now + (self.decision.report_s if self.decision else 120)
        if self.api:
            self.next_net = min(self.next_net, now)

    def _flush(self, now: float, force: bool = False, limit: Optional[int] = None) -> None:
        if not self.api or self.auth_failed and not force:
            return
        if self.urgent and not force and now - self.last_net_try < MIN_URGENT_GAP_S:
            return
        if not force and now < self.next_net and not self.urgent:
            return
        if not self.store.depth():
            self.urgent = False
            return
        self.last_net_try = now
        self.urgent = False
        wifi_floor = self.decision.wifi_retry_s if self.decision else 60
        for _ in range(limit or self.cfg.max_requests_per_flush):
            skip = ("beacon",) if now < self.beacon_hold_until else ()
            head = self.store.peek(limit=1, skip_kinds=skip)
            if not head:
                if self.store.depth():     # only held-back beacons remain: wait for their retry time, do not spin
                    self.next_net = max(now + 1.0, self.beacon_hold_until)
                else:
                    self.backoff.success()
                break
            item = head[0]
            kind = item["kind"]
            if kind == "ingest":
                batch = self.store.peek("ingest", 20)
                readings: list = []
                ids = []
                for b in batch:
                    rs = b["body"].get("readings", [])
                    if len(readings) + len(rs) > BATCH_READINGS:
                        break
                    readings += rs
                    ids.append(b["id"])
                if not ids:
                    ids, readings = [item["id"]], item["body"].get("readings", [])[:BATCH_READINGS]
                res = self.api.ingest(readings)
            elif kind == "beacon":
                ids = [item["id"]]
                res = self.api.beacon_ingest(item["body"])
            else:
                ids = [item["id"]]
                res = self.api.event(item["body"].get("type", "agent.event"), item["body"].get("data"))
            if res.ok:
                self.store.ack(ids)
                self.counters["sent"] += 1
                self.backoff.success()
                self.last_ok = now
                self.last_error = ""
                self.auth_failed = False
                if isinstance(res.body, dict):
                    if res.body.get("messages_pending"):
                        self.next_poll = min(self.next_poll, now)
                    ps = res.body.get("poll_after_s")
                    if isinstance(ps, int) and 10 <= ps <= 300:
                        self.server_poll = ps
                continue
            if res.retry:
                self.store.failed(ids)
                self.counters["retries"] += 1
                delay = self.backoff.failure(wifi_floor)
                self.next_net = now + delay
                self.last_error = f"network or server problem ({res.status or res.error}); retrying in {int(delay)} s"
                break
            if res.auth:
                self.auth_failed = True
                self.last_error = "the API rejected the device key (401/403): re-provision this device"
                self.next_net = now + 3600
                self.say(self.last_error, logging.ERROR)
                break
            if res.status == 409 and kind == "beacon":
                # Never drop a beacon on 409. The server also says 409 while an earlier try is still being
                # processed, and the same event must be resent as it is. Keep the row and retry later.
                self.store.failed(ids)
                self.counters["conflicts"] += 1
                delay = self.backoff.failure(wifi_floor)
                no_home = "assign a home" in (res.error or "").lower()
                if no_home and not self.store.stats()["critical"]:
                    # The device has no home yet: stop making new routine beacons for an hour. Only when no
                    # critical row is waiting, so a water alarm is never paused behind this.
                    self.beacon_disabled_until = self.wall() + 3600
                    delay = max(delay, 3600.0)
                    self.last_error = "beacon telemetry refused (409): the device has no home yet; pausing new beacon posts for an hour, queued ones are kept"
                else:
                    self.last_error = f"beacon not accepted yet (409); kept in the queue, retrying in {int(delay)} s"
                self.beacon_hold_until = now + delay
                self.say(self.last_error, logging.WARNING)
                continue
            # 400/413/other 4xx: this payload will never be accepted. Quarantine it, keep going.
            self.store.ack(ids)
            self.counters["rejected"] += 1
            self.last_error = f"payload rejected ({res.status}): {res.error[:80]}"
            log.warning("%s", self.last_error)
        else:
            self.next_net = now + 2.0     # more waiting: keep draining the backlog in short, bounded bursts
            return
        if not self.store.depth():
            self.next_net = now + (self.decision.report_s if self.decision else 60)

    # ------------------------------------------------------------ messages and commands
    def _poll(self, now: float) -> None:
        if self.auth_failed:
            self.next_poll = now + 3600
            return
        res = self.api.messages(self.cursor, 3)
        self.counters["polls"] += 1
        interval = self._poll_seconds()
        if not res.ok or not isinstance(res.body, dict):
            if res.retry:
                self.next_poll = now + self.backoff.failure(self.decision.wifi_retry_s if self.decision else 60)
            elif res.auth:
                self.auth_failed = True
                self.next_poll = now + 3600
            else:
                self.next_poll = now + interval
            return
        b = res.body
        self.backoff.success()
        self.last_ok = now
        ps = b.get("poll_after_s")
        if isinstance(ps, int) and 10 <= ps <= 300:
            self.server_poll = ps
        msgs = b.get("messages") if isinstance(b.get("messages"), list) else []
        for m in msgs[:3]:
            if isinstance(m, dict):
                self._handle_message(m)
        cur = b.get("cursor")
        if isinstance(cur, int) and cur >= self.cursor:
            self.cursor = cur
            self.store.put("cursor", cur)
        conf = b.get("configuration")
        if isinstance(conf, dict):
            self._apply_settings(conf)
        if self.unreported_rev:
            self._report_settings()
        self.next_poll = now + (2.0 if len(msgs) >= 3 else self._poll_seconds())

    def _apply_settings(self, conf: dict) -> None:
        rev, secs = conf.get("revision"), conf.get("pollAfterSeconds")
        if not (isinstance(rev, int) and isinstance(secs, int) and commands.POLL_MIN <= secs <= commands.POLL_MAX):
            return
        if rev != self.settings_rev:
            self.settings_poll = secs
            self.settings_rev = rev
            self.store.put("settings_rev", rev)
            self.unreported_rev = (rev, secs)
            self.say(f"Operator set the message check interval to {secs} seconds.")

    def _report_settings(self) -> None:
        rev, secs = self.unreported_rev
        res = self.api.report_settings(rev, secs)
        if res.ok or res.status in (403, 409):
            # 409: a newer revision exists, the next poll fetches it. 403: exercise device, settings are not allowed.
            self.unreported_rev = None
            if res.status == 403:
                log.warning("the server does not accept settings reports from this device (exercise device?)")

    def _handle_message(self, m: dict) -> None:
        mid = str(m.get("id", ""))
        title, body = str(m.get("title", "")), str(m.get("body", ""))
        sev = str(m.get("severity", "info"))
        if m.get("kind") == "instruction" and commands.is_command_message(title):
            self._handle_command_message(mid, title, body)
            return
        self.say(f"Message ({sev}) {title}: {body}", logging.WARNING if sev == "urgent" else logging.INFO)
        if mid:
            self.api.report_message(mid, "shown")
        self.live.inbox[-1]["id"] = mid
        self.live.inbox[-1]["requires_ack"] = bool(m.get("requires_ack"))

    def _handle_command_message(self, mid: str, title: str, body: str) -> None:
        if not self.cfg.allow_commands:
            self.counters["commands_refused"] += 1
            self.say(f"Command message ignored (remote commands are off): {title}")
            if mid:
                self.api.report_message(mid, "shown")
            return
        if mid and self.store.seen("cmd:" + mid):
            self.api.report_message(mid, "acked")     # already done once; just close it again
            return
        try:
            cmd = commands.from_message(title, body, allow_reboot=self.cfg.allow_reboot_agent)
        except commands.CommandError as e:
            self.counters["commands_refused"] += 1
            self.say(f"Command refused: {e}", logging.WARNING)
            self._event("agent.cmd_refused", {"why": str(e)[:100]})
            if mid:
                self.store.mark("cmd:" + mid)
                self.api.report_message(mid, "shown")
            return
        if mid:
            self.store.mark("cmd:" + mid)
        self._exec(cmd, "operator")
        if mid:
            self.api.report_message(mid, "acked")

    def _local_ack(self, arg: str) -> None:
        pending = [i for i in self.live.inbox if i.get("requires_ack") and i.get("id")]
        target = next((i for i in reversed(pending) if not arg or i["id"].startswith(arg)), None)
        if not target:
            self.say("No message is waiting to be acknowledged.")
            return
        res = self.api.report_message(target["id"], "acked") if self.api else None
        if res and res.ok:
            target["requires_ack"] = False
            self.say(f"Acknowledged: {target['text'][:60]}")
        else:
            self.say("Could not acknowledge right now; try again when the link is up.", logging.WARNING)

    def _exec(self, cmd: commands.Command, via: str) -> None:
        now = self.mono()
        self.counters["commands"] += 1
        n, a = cmd.name, cmd.args
        if n == "poll":
            self.poll_override = (a[0], now + 3600)
            self.next_poll = now
            self.say(f"Command ({via}): check messages every {a[0]} seconds for the next hour.")
        elif n == "mode":
            if a[0] == "auto":
                self.mode_override = None
                self.say(f"Command ({via}): power mode back to automatic.")
            else:
                self.mode_override = (a[0], now + a[1] * 60)
                self.say(f"Command ({via}): hold {a[0]} mode for {a[1]} minutes if the battery allows.")
            self.next_power = now
        elif n == "identify":
            self.identify_until = now + a[0]
            self.say(f"Command ({via}): identify for {a[0]} seconds. *** HERE I AM ***")
            if self.cfg.mcu_identify_line:
                self.source.write_line(self.cfg.mcu_identify_line)
        elif n == "mute":
            self.muted = a[0] == "on"
            log.info("display muted=%s", self.muted)
        elif n == "status":
            self._push_status(self.wall(), PRIO_STATUS)
            self._push_beacon(self.wall(), prio=PRIO_STATUS)
            self.urgent = True
            self.say(f"Command ({via}): status report queued.")
        elif n == "resync":
            self.cursor = 0
            self.store.put("cursor", 0)
            self.settings_rev = None
            self.next_poll = self.next_net = now
            self.say(f"Command ({via}): re-reading messages and settings.")
        elif n == "reboot-agent":
            self.say(f"Command ({via}): restarting the agent.", logging.WARNING)
            self.exit_code = 75
            self.stop.set()
        self._event("agent.cmd", {"cmd": cmd.text(), "via": via})

    # ------------------------------------------------------------ status
    def status(self) -> dict:
        now = self.mono()
        d = self.decision
        br = self.battery
        return {
            "version": VERSION, "boot": self.boot, "uptime_s": int(now - self.t_start),
            "device_id": self.cfg.device_id or None,
            "mcu": {"source": self.source.name, "connected": bool(self.source.connected), "error": self.source.last_error},
            "hazard": {"active": self.hazard_state[0], "reasons": self.hazard_state[1],
                       "known": self.hazard_state[0] or self.live.fresh_any(now)},
            "mains": self.live.mains(now) if self.live.mains(now) != "unknown" else self.mains_observed,
            "mains_assumed": self.cfg.assume_mains if self.mains_observed == "unknown" else None,
            "power": None if d is None else {
                "mode": d.mode, "server_mode": d.server_mode, "hazard_boost": d.hazard_boost, "report_s": d.report_s,
                "poll_s": self._poll_seconds(), "sample_s": d.sample_s, "avg_mw_estimate": d.avg_mw,
                "hours_remaining": d.hours_remaining, "hours_with_beacon_tail": d.hours_with_beacon_tail,
                "target_hours": d.target_hours, "meets_target": d.meets_target, "confidence": d.confidence,
                "load_basis": d.basis, "last_gasp_active": d.last_gasp_active, "reserve_wh": d.reserve_wh,
                "reasons": d.reasons, "assumptions": d.assumptions, "table": d.table,
                "os_settings": system.recommended_os_settings(d.mode),
                "battery": None if br is None else {"soc_pct": br.soc_pct, "soc_source": br.soc_source, "note": br.note,
                                                    "estimated_soc_pct": None if self.batt is None or self.batt.soc_pct is None else round(self.batt.soc_pct, 1),
                                                    "estimate_source": None if self.batt is None else self.batt.soc_source,
                                                    "energy_used_wh": round(self.used_wh, 3)},
            },
            "uplink": {"last_ok_age_s": None if self.last_ok is None else round(now - self.last_ok, 1), "auth_failed": self.auth_failed,
                       "backoff_n": self.backoff.n, "last_error": self.last_error, **self.counters, "queue": self.store.stats()},
            "settings": {"poll_effective_s": self._poll_seconds(), "revision": self.settings_rev, "server_poll_s": self.server_poll},
            "display_muted": self.muted, "identify": self.identify_until > now,
            "live": self.live.view(now), "gauges": self.gauges[-1] if self.gauges else {},
        }
