"""Allowlisted control commands. Text in, typed command out. Nothing here executes anything.

Operators send an information box (POST /api/ops/messages, kind `instruction`) whose title starts
with `CMD`. The title is at most 20 characters and the body at most 80 plain characters with no
links, so a command fits as, for example, title `CMD` and body `poll 60`, or title `CMD poll 60`.
Typed settings (GET/POST /api/device/settings, poll interval) are handled separately by the agent.

The same parser backs the local bench CLI (`agent cmd poll 60`). Anything outside the table below
is rejected with a plain sentence, including every shell-like input.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

POLL_MIN, POLL_MAX = 10, 300
MODE_NAMES = ("auto", "full", "eco", "survival", "beacon")
HOLD_MIN_DEFAULT, HOLD_MIN_MAX = 60, 240

# name -> (usage, summary)
ALLOWLIST = {
    "poll": ("poll <10-300>", "Set how often the hub asks for messages, in seconds."),
    "mode": ("mode <auto|full|eco|survival|beacon> [minutes]", "Hold a power mode for up to 240 minutes, or release with auto."),
    "identify": ("identify [seconds 1-30]", "Blink the status marker and ring the box beeper if one is mapped."),
    "mute": ("mute <on|off>", "Mute or unmute the local display and terminal notices."),
    "status": ("status", "Send a status report now."),
    "resync": ("resync", "Re-read messages and settings and flush the offline queue."),
    "reboot-agent": ("reboot-agent", "Restart the agent process (off unless enabled in the config)."),
}
_TOKEN = re.compile(r"^[A-Za-z0-9-]{1,16}$")


class CommandError(ValueError):
    pass


@dataclass(frozen=True)
class Command:
    name: str
    args: tuple = ()

    def text(self) -> str:
        return " ".join((self.name, *map(str, self.args)))


def is_command_message(title: str) -> bool:
    return isinstance(title, str) and title.strip().upper().split(" ")[0] == "CMD"


def parse(text: str, *, allow_reboot: bool = False) -> Command:
    if not isinstance(text, str) or len(text) > 100:
        raise CommandError("Command text is missing or too long.")
    parts = text.strip().split()
    if not parts or not all(_TOKEN.match(p) for p in parts):
        raise CommandError("Commands use letters, digits and dashes only.")
    name, args = parts[0].lower(), parts[1:]
    if name not in ALLOWLIST:
        raise CommandError(f"Unknown command '{name[:16]}'. Allowed: {', '.join(sorted(ALLOWLIST))}.")
    if name == "reboot-agent" and not allow_reboot:
        raise CommandError("reboot-agent is turned off in this agent's config.")

    def one_int(lo: int, hi: int, label: str, default: Optional[int] = None) -> int:
        if not args:
            if default is None:
                raise CommandError(f"{label} is required.")
            return default
        if len(args) > 1 or not args[0].isdigit() or not lo <= int(args[0]) <= hi:
            raise CommandError(f"{label} must be a whole number from {lo} to {hi}.")
        return int(args[0])

    if name == "poll":
        return Command(name, (one_int(POLL_MIN, POLL_MAX, "poll seconds"),))
    if name == "identify":
        return Command(name, (one_int(1, 30, "identify seconds", 5),))
    if name == "mode":
        if not args or args[0].lower() not in MODE_NAMES or len(args) > 2:
            raise CommandError(f"mode must be one of {', '.join(MODE_NAMES)}.")
        mins = HOLD_MIN_DEFAULT
        if len(args) == 2:
            if not args[1].isdigit() or not 1 <= int(args[1]) <= HOLD_MIN_MAX:
                raise CommandError(f"mode minutes must be a whole number from 1 to {HOLD_MIN_MAX}.")
            mins = int(args[1])
        return Command(name, (args[0].lower(), mins))
    if name == "mute":
        if len(args) != 1 or args[0].lower() not in ("on", "off"):
            raise CommandError("mute must be on or off.")
        return Command(name, (args[0].lower(),))
    if args:
        raise CommandError(f"{name} takes no arguments.")
    return Command(name)


def from_message(title: str, body: str, *, allow_reboot: bool = False) -> Command:
    t = (title or "").strip().split(None, 1)
    rest = t[1] if len(t) > 1 else ""
    return parse(f"{rest} {body or ''}".strip(), allow_reboot=allow_reboot)


def help_text() -> str:
    width = max(len(u) for u, _ in ALLOWLIST.values())
    return "\n".join(f"  {u.ljust(width)}  {s}" for u, s in ALLOWLIST.values())
