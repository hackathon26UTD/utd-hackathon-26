"""Update check. It only ever OFFERS a checksummed release; it never runs downloaded code.

The release manifest (public/downloads/unoq/manifest.json, built by scripts/package-unoq.mjs) lists
the tarball name, size and sha256. `check` compares versions. `download` fetches the tarball over
HTTPS from the same origin, verifies size and sha256, stores it under <state>/updates/ and prints the
command an operator runs to install it. Installing is a separate, deliberate step done by install.sh,
which verifies the checksum again and, when a public key is supplied, an Ed25519 signature.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import ssl
import urllib.error
import urllib.request
from typing import Optional

from . import VERSION

MAX_MANIFEST = 16_384
MAX_TARBALL = 2_000_000
NAME_RE = re.compile(r"^homebeacon-unoq-[0-9]+\.[0-9]+\.[0-9]+\.tar\.gz$")


class UpdateError(RuntimeError):
    pass


def vtuple(v: str) -> tuple:
    m = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", v or "")
    if not m:
        raise UpdateError(f"Not a version number: {v!r}")
    return tuple(int(x) for x in m.groups())


def _get(url: str, limit: int, timeout: float = 15.0, opener=None) -> bytes:
    if not url.startswith("https://") and not re.match(r"http://(127\.0\.0\.1|localhost)(:\d+)?/", url):
        raise UpdateError("Updates are fetched over https:// only.")
    op = opener or urllib.request.build_opener(urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    try:
        with op.open(urllib.request.Request(url, headers={"User-Agent": "homebeacon-unoq-agent"}), timeout=timeout) as r:
            data = r.read(limit + 1)
    except (urllib.error.URLError, OSError) as e:
        raise UpdateError(f"Could not reach the update server ({type(e).__name__}).")
    if len(data) > limit:
        raise UpdateError("The update server sent more data than expected; refusing.")
    return data


def validate_manifest(m: dict) -> dict:
    if not isinstance(m, dict):
        raise UpdateError("Manifest is not an object.")
    vtuple(m.get("version", ""))
    if not NAME_RE.match(str(m.get("file", ""))):
        raise UpdateError("Manifest file name is not an expected release name.")
    if not re.fullmatch(r"[0-9a-f]{64}", str(m.get("sha256", ""))):
        raise UpdateError("Manifest has no valid sha256.")
    if not isinstance(m.get("size"), int) or not 0 < m["size"] <= MAX_TARBALL:
        raise UpdateError("Manifest size is missing or too large.")
    return m


def check(base: str, opener=None, current: str = VERSION) -> dict:
    base = base.rstrip("/")
    m = validate_manifest(json.loads(_get(f"{base}/downloads/unoq/manifest.json", MAX_MANIFEST, opener=opener)))
    newer = vtuple(m["version"]) > vtuple(current)
    return {"current": current, "latest": m["version"], "update_available": newer, "manifest": m,
            "note": "Checksummed release. Not installed automatically." if newer else "Already on the latest release."}


def download(base: str, dest_dir: str, opener=None) -> dict:
    info = check(base, opener)
    m = info["manifest"]
    data = _get(f"{base.rstrip('/')}/downloads/unoq/{m['file']}", MAX_TARBALL, opener=opener)
    if len(data) != m["size"] or hashlib.sha256(data).hexdigest() != m["sha256"]:
        raise UpdateError("Downloaded file does not match the manifest checksum; discarded.")
    os.makedirs(dest_dir, mode=0o700, exist_ok=True)
    path = os.path.join(dest_dir, m["file"])
    tmp = path + ".part"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)
    info["staged"] = path
    info["install_command"] = f"sudo sh install.sh --file {path} --sha256 {m['sha256']}"
    return info
