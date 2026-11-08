"""MCU sources. Each source pushes parsed `HB {json}` dicts to a callback from its own thread.

serial  Box A over USB (what firmware/hub/hub.py does). Reads with select() and a timeout so the
        thread sleeps in the kernel instead of spinning. stty is used instead of pyserial.
bridge  Arduino App Lab Bridge on the Uno Q's Linux side. UNVERIFIED on real hardware: the module
        names below follow Arduino's App Lab Python API as documented, and nothing here has run
        on a board. If the import fails the source reports it and the agent keeps running.
fake    Deterministic generator for bench runs and tests. No hardware.
"""
from __future__ import annotations

import glob
import os
import random
import select
import subprocess
import threading
import time
from typing import Callable, Optional

from .protocol import MAX_LINE, parse_hb_line

Callback = Callable[[dict], None]


class Source:
    name = "none"
    connected = False
    last_error = ""

    def start(self, cb: Callback, stop: threading.Event) -> None:
        pass

    def write_line(self, text: str) -> bool:
        return False


class SerialSource(Source):
    name = "serial"

    def __init__(self, port: str = "", baud: int = 115200):
        self.port, self.baud = port, baud
        self._fd: Optional[int] = None
        self._lock = threading.Lock()

    def _find(self) -> Optional[str]:
        if self.port:
            return self.port
        found = sorted(glob.glob("/dev/ttyACM*") + glob.glob("/dev/ttyUSB*"))
        return found[0] if found else None

    def start(self, cb: Callback, stop: threading.Event) -> None:
        threading.Thread(target=self._run, args=(cb, stop), name="mcu-serial", daemon=True).start()

    def _run(self, cb: Callback, stop: threading.Event) -> None:
        wait = 2.0
        while not stop.is_set():
            port = self._find()
            if not port:
                self.connected, self.last_error = False, "no USB serial device found"
                stop.wait(min(wait, 30.0))
                wait = min(wait * 1.5, 30.0)
                continue
            try:
                subprocess.run(["stty", "-F", port, str(self.baud), "raw", "-echo"], check=False, timeout=5,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                fd = os.open(port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
            except (OSError, subprocess.SubprocessError) as e:
                self.connected, self.last_error = False, f"cannot open {port}: {type(e).__name__}"
                stop.wait(min(wait, 30.0))
                wait = min(wait * 1.5, 30.0)
                continue
            with self._lock:
                self._fd = fd
            self.connected, self.last_error, wait = True, "", 2.0
            buf = b""
            try:
                while not stop.is_set():
                    r, _, _ = select.select([fd], [], [], 1.0)   # sleeps up to 1 s per wake
                    if not r:
                        continue
                    chunk = os.read(fd, 512)
                    if not chunk:
                        raise OSError("serial closed")
                    buf += chunk
                    while b"\n" in buf:
                        raw, buf = buf.split(b"\n", 1)
                        msg = parse_hb_line(raw[:MAX_LINE].decode("utf-8", "replace"))
                        if msg:
                            cb(msg)
                    if len(buf) > MAX_LINE:
                        buf = b""    # a line that never ends is noise; drop it
            except OSError as e:
                self.connected, self.last_error = False, f"serial error: {type(e).__name__}"
            finally:
                with self._lock:
                    self._fd = None
                try:
                    os.close(fd)
                except OSError:
                    pass
            stop.wait(2.0)

    def write_line(self, text: str) -> bool:
        with self._lock:
            if self._fd is None:
                return False
            try:
                os.write(self._fd, (text + "\n").encode("ascii", "replace")[:64])
                return True
            except OSError:
                return False


class BridgeSource(Source):
    """UNVERIFIED. Arduino App Lab (Uno Q) exposes the MCU to Linux Python through its Bridge."""
    name = "bridge"

    def start(self, cb: Callback, stop: threading.Event) -> None:
        try:
            from arduino.app_utils import Bridge  # type: ignore  # present only on the Uno Q image
        except Exception as e:  # noqa: BLE001
            self.connected, self.last_error = False, f"Bridge not available here: {type(e).__name__}"
            return

        def provide(line: str) -> None:
            msg = parse_hb_line(line if line.startswith("HB ") else "HB " + line)
            if msg:
                cb(msg)

        try:
            Bridge.provide("hb_line", provide)   # the MCU sketch must call Bridge.notify("hb_line", "<json>")
            self.connected = True
            self._bridge = Bridge
        except Exception as e:  # noqa: BLE001
            self.connected, self.last_error = False, f"Bridge.provide failed: {type(e).__name__}"

    def write_line(self, text: str) -> bool:
        try:
            self._bridge.call("hb_cmd", text)  # needs matching firmware; none exists in this repo
            return True
        except Exception:  # noqa: BLE001
            return False


class FakeSource(Source):
    """Deterministic fake MCU. `scenario` is quiet, flood, outage or mixed."""
    name = "fake"

    def __init__(self, scenario: str = "quiet", interval_s: float = 2.0, seed: int = 7, scripted: Optional[list] = None):
        self.scenario, self.interval, self.rng = scenario, interval_s, random.Random(seed)
        self.scripted = scripted
        self.written: list[str] = []
        self.t0 = time.monotonic()

    def start(self, cb: Callback, stop: threading.Event) -> None:
        self.connected = True
        threading.Thread(target=self._run, args=(cb, stop), name="mcu-fake", daemon=True).start()

    def _run(self, cb: Callback, stop: threading.Event) -> None:
        seq = 0
        if self.scripted:
            for m in self.scripted:
                if stop.wait(self.interval):
                    return
                cb(dict(m))
            return
        while not stop.is_set():
            seq += 1
            el = time.monotonic() - self.t0
            wet = self.scenario in ("flood", "mixed") and el > 20
            mains = not (self.scenario in ("outage", "mixed") and el > 10)
            cb({"box": "A", "type": "reading", "seq": seq, "hops": 0, "water": wet, "mains": mains,
                "motion": False, "battery_mv": 7800 + self.rng.randint(-20, 20), "gateway": "A"})
            if wet and seq % 5 == 0:
                cb({"box": "A", "type": "event", "seq": seq, "event": "water.detected", "hops": 0})
            if stop.wait(self.interval):
                return

    def write_line(self, text: str) -> bool:
        self.written.append(text)
        return True


def make(kind: str, port: str = "", baud: int = 115200, scenario: str = "quiet") -> Source:
    if kind == "serial":
        return SerialSource(port, baud)
    if kind == "bridge":
        return BridgeSource()
    if kind == "fake":
        return FakeSource(scenario)
    return Source()
