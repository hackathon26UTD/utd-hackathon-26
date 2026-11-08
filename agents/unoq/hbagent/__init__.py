"""HomeBeacon Uno Q agent. Standard library only, Python 3.11+."""
from pathlib import Path

VERSION = "0.0.0"
for _p in (Path(__file__).resolve().parent.parent / "VERSION", Path(__file__).resolve().parent / "VERSION"):
    try:
        VERSION = _p.read_text().strip()
        break
    except OSError:
        continue
