"""Small durable state: bounded offline queue, message cursor, processed-command ids, boot counter.

SQLite in WAL mode, one file in the agent's state directory. Everything is capped:
  - queue rows (default 2000) and bytes (default 2 MB). Oldest low-priority rows go first.
  - Critical rows (priority 0) are dropped only when critical rows alone exceed the caps.
  - processed command ids keep the newest 200.
"""
from __future__ import annotations

import json
import secrets
import sqlite3
import threading
import time
from typing import Optional

PRIO_CRITICAL, PRIO_STATUS, PRIO_ROUTINE = 0, 1, 2
KINDS = ("beacon", "ingest", "event")


class Store:
    def __init__(self, path: str, max_rows: int = 2000, max_bytes: int = 2_000_000):
        self.path = path
        self.max_rows = max_rows
        self.max_bytes = max_bytes
        self._lock = threading.Lock()
        self.con = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.con.execute("PRAGMA journal_mode=WAL")
        self.con.execute("PRAGMA synchronous=NORMAL")
        self.con.execute("PRAGMA wal_autocheckpoint=200")
        self.con.execute("CREATE TABLE IF NOT EXISTS q (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, eid TEXT, prio INTEGER NOT NULL, "
                         "created REAL NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL, size INTEGER NOT NULL)")
        self.con.execute("CREATE INDEX IF NOT EXISTS q_order ON q(prio, id)")
        self.con.execute("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)")
        self.con.execute("CREATE TABLE IF NOT EXISTS done (id TEXT PRIMARY KEY, at REAL)")
        self.dropped = 0

    # ---- meta ----
    def get(self, key: str, default=None):
        with self._lock:
            row = self.con.execute("SELECT v FROM meta WHERE k=?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def put(self, key: str, value) -> None:
        with self._lock:
            self.con.execute("INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (key, json.dumps(value)))

    def next_boot(self) -> int:
        n = int(self.get("boot", 0)) + 1
        self.put("boot", n)
        return n

    # ---- processed ids ----
    def seen(self, ident: str) -> bool:
        with self._lock:
            return self.con.execute("SELECT 1 FROM done WHERE id=?", (ident,)).fetchone() is not None

    def mark(self, ident: str, now: Optional[float] = None) -> None:
        with self._lock:
            self.con.execute("INSERT OR REPLACE INTO done(id, at) VALUES(?,?)", (ident, now or time.time()))
            self.con.execute("DELETE FROM done WHERE id NOT IN (SELECT id FROM done ORDER BY at DESC LIMIT 200)")

    # ---- queue ----
    def push(self, kind: str, body: dict, prio: int = PRIO_ROUTINE, eid: Optional[str] = None, now: Optional[float] = None) -> None:
        if kind not in KINDS:
            raise ValueError(kind)
        text = json.dumps(body, separators=(",", ":"))
        if eid is None and kind == "event":
            eid = "ev-" + secrets.token_hex(10)      # stable across retries: the same row always resends the same id
        with self._lock:
            self.con.execute("INSERT INTO q(kind, eid, prio, created, body, size) VALUES(?,?,?,?,?,?)",
                             (kind, eid, prio, now or time.time(), text, len(text)))
            self._trim()

    def _trim(self) -> None:
        rows, size = self.con.execute("SELECT COUNT(*), COALESCE(SUM(size),0) FROM q").fetchone()
        while rows > self.max_rows or size > self.max_bytes:
            # lowest-value first: routine, then status, then critical; oldest first inside each class
            victim = self.con.execute("SELECT id, size FROM q ORDER BY prio DESC, id ASC LIMIT 1").fetchone()
            if not victim:
                break
            self.con.execute("DELETE FROM q WHERE id=?", (victim[0],))
            rows -= 1
            size -= victim[1]
            self.dropped += 1

    def depth(self) -> int:
        with self._lock:
            return self.con.execute("SELECT COUNT(*) FROM q").fetchone()[0]

    def stats(self, now: Optional[float] = None) -> dict:
        with self._lock:
            rows, size = self.con.execute("SELECT COUNT(*), COALESCE(SUM(size),0) FROM q").fetchone()
            crit = self.con.execute("SELECT COUNT(*) FROM q WHERE prio=0").fetchone()[0]
            oldest = self.con.execute("SELECT MIN(created) FROM q").fetchone()[0]
            kinds = dict(self.con.execute("SELECT kind, COUNT(*) FROM q GROUP BY kind").fetchall())
            attempts = self.con.execute("SELECT COALESCE(MAX(attempts),0) FROM q").fetchone()[0]
        age = None if oldest is None else round(max(0.0, (now or time.time()) - oldest), 1)
        return {"rows": rows, "bytes": size, "critical": crit, "oldest": oldest, "dropped": self.dropped,
                "oldest_age_s": age, "by_kind": kinds, "max_attempts": attempts,
                "max_rows": self.max_rows, "max_bytes": self.max_bytes}

    def peek(self, kind: Optional[str] = None, limit: int = 1, skip_kinds: tuple = ()) -> list[dict]:
        """Oldest first within priority. Does not remove anything. `skip_kinds` leaves those kinds out of the view."""
        with self._lock:
            sql = "SELECT id, kind, eid, prio, created, attempts, body FROM q"
            args: tuple = ()
            if kind:
                sql += " WHERE kind=?"
                args = (kind,)
            elif skip_kinds:
                sql += " WHERE kind NOT IN (%s)" % ",".join("?" * len(skip_kinds))
                args = tuple(skip_kinds)
            rows = self.con.execute(sql + " ORDER BY prio ASC, id ASC LIMIT ?", (*args, limit)).fetchall()
        return [{"id": r[0], "kind": r[1], "eid": r[2], "prio": r[3], "created": r[4], "attempts": r[5], "body": json.loads(r[6])} for r in rows]

    def head_kind(self) -> Optional[str]:
        rows = self.peek(limit=1)
        return rows[0]["kind"] if rows else None

    def ack(self, ids: list[int]) -> None:
        if not ids:
            return
        with self._lock:
            self.con.executemany("DELETE FROM q WHERE id=?", [(i,) for i in ids])

    def failed(self, ids: list[int]) -> None:
        with self._lock:
            self.con.executemany("UPDATE q SET attempts=attempts+1 WHERE id=?", [(i,) for i in ids])

    def close(self) -> None:
        with self._lock:
            self.con.close()
