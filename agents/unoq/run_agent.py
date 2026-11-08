#!/usr/bin/env python3
"""Thin shim so `python3 run_agent.py <command>` works from an unpacked release."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hbagent.cli import main  # noqa: E402

sys.exit(main())
