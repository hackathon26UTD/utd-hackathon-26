"""Glue between the agent loop and the self-update, boot guard and environment report.

Hooks an Agent without editing it: wraps agent.step() and agent.status(). Everything slow (the update check and
download) runs in one short-lived worker thread, so the loop never blocks. Everything here fails soft: a bug in
this layer must never stop sensing or alerting.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Callable, Optional

from . import bootguard, envreport, updater

log = logging.getLogger("hbagent.lifecycle")

HEALTH_EVERY_S = 30.0      # boot guard health check
UPDATE_EVERY_S = 60.0      # how often the loop asks "is a check due" (cheap: reads one small file)
ENV_EVERY_S = 60.0         # environment upload schedule check (the reporter decides if an upload is really due)


class Lifecycle:
    def __init__(self, agent, cfg, store, *, prefix: Optional[str] = None, clock: Callable[[], float] = time.time,
                 auto_update: bool = True):
        self.agent, self.cfg, self.store = agent, cfg, store
        self.prefix = prefix
        self.clock = clock
        self.auto_update = auto_update
        self.settings = updater.Settings.load(cfg, prefix)
        self.guard = bootguard.Guard(self.settings.prefix, self.settings.state_dir, clock=clock)
        # Managed = installed by install.sh or the updater (releases/<v> + current link). A source checkout run by hand
        # has no release to guard, update or roll back, so those parts stay off and only the environment report runs.
        self.managed = bootguard.current_version(self.settings.prefix) is not None
        self.reporter = envreport.EnvReporter(cfg, store, status_fn=lambda: self._raw_status(), wall=clock)
        self._raw_status = agent.status
        self._next_health = self._next_update = self._next_env = 0.0
        self._workers: dict = {}
        self._inner_step = agent.step

    # -- hooks
    def install(self) -> "Lifecycle":
        try:
            if self.managed:
                self.guard.record_start()
        except Exception:  # noqa: BLE001
            log.debug("record_start failed", exc_info=True)
        agent = self.agent
        raw_status = agent.status

        def status() -> dict:
            st = raw_status()
            try:
                st["env"] = self.reporter.snapshot()
                st["update"] = self._short_update() if self.managed else None
            except Exception:  # noqa: BLE001
                log.debug("env snapshot failed", exc_info=True)
            return st

        def step() -> float:
            try:
                self.before_step()
            except Exception:  # noqa: BLE001
                log.debug("lifecycle step failed", exc_info=True)
            return self._inner_step()

        self._raw_status = raw_status
        agent.status = status
        agent.step = step
        return self

    def _short_update(self) -> dict:
        s = self.settings
        return {"channel": s.channel, "auto_apply": s.auto_apply, "current": updater.installed_version(s.prefix)}

    def before_step(self) -> None:
        t = self.clock()
        if self.managed and t >= self._next_health:
            self._next_health = t + HEALTH_EVERY_S
            self._spawn("health", self._health_job)
        if t >= self._next_env:
            self._next_env = t + ENV_EVERY_S
            self._spawn("env", self._env)
        if self.managed and self.auto_update and t >= self._next_update:
            self._next_update = t + UPDATE_EVERY_S
            self._spawn("update", self._update_job)

    def _spawn(self, name: str, fn: Callable[[], None]) -> None:
        """One worker per job kind; a job still running is never stacked. Keeps slow work off the agent loop."""
        th = self._workers.get(name)
        if th is not None and th.is_alive():
            return
        th = threading.Thread(target=self._guarded, args=(name, fn), name=f"hb-{name}", daemon=True)
        self._workers[name] = th
        th.start()

    @staticmethod
    def _guarded(name: str, fn: Callable[[], None]) -> None:
        try:
            fn()
        except Exception:  # noqa: BLE001
            log.exception("%s job crashed", name)

    # -- jobs
    def _health_job(self) -> None:
        res = updater.health_tick(self.cfg, self._raw_status(), prefix=self.prefix, settings=self.settings, now=self.clock,
                                  uplink_expected=getattr(self.agent, "api", None) is not None)
        updater.flush_events(self.cfg, lambda etype, data: self.agent._event(etype, data))
        if res.get("action") == "restart":
            self.request_restart("rolled back to the previous release")

    def _env(self) -> None:
        ev = self.reporter.tick()
        if ev:
            self.agent._event(ev["type"], ev["data"])

    def _update_job(self) -> None:
        hazard = bool(self.agent.hazard_state[0])
        res = updater.auto_update_tick(self.cfg, hazard=hazard, prefix=self.prefix, settings=self.settings, now=self.clock)
        if res and res.get("restart_required"):
            self.request_restart(f"updated to {res.get('to_version')}")

    def request_restart(self, why: str) -> None:
        log.warning("restarting the agent: %s", why)
        self.agent.exit_code = updater.RESTART_EXIT_CODE
        self.agent.stop.set()
        self.agent.wake.set()

    def close(self) -> None:
        """Deliberate stop: do not count it as a crash."""
        if self.managed and self.agent.stop.is_set():
            self.guard.clean_stop()
