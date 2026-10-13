"""Hash-chained audit log.

Every row commits to the previous row's hash, so editing or deleting any past
row breaks verification from that point on. ``verify()`` is exposed on the API
and run by the Internal Audit agent.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone

from ..storage.store import Store, dumps


def _row_hash(prev_hash: str, ts: str, actor: str, action: str, target: str, outcome: str, details: str) -> str:
    return hashlib.sha256("\x1f".join([prev_hash, ts, actor, action, target, outcome, details]).encode()).hexdigest()


@dataclass(frozen=True)
class ChainStatus:
    ok: bool
    rows: int
    first_bad_seq: int | None = None


class AuditLog:
    def __init__(self, store: Store):
        self.store = store

    def record(self, actor: str, action: str, target: str, outcome: str, details: dict | None = None) -> dict:
        details_json = dumps(details or {})

        def build(prev_hash: str) -> dict:
            ts_s = datetime.now(timezone.utc).isoformat()
            return {"ts": ts_s, "actor": actor, "action": action, "target": target, "outcome": outcome,
                    "details": details_json, "prev_hash": prev_hash,
                    "hash": _row_hash(prev_hash, ts_s, actor, action, target, outcome, details_json)}
        return self.store.audit_append(build)

    def rows(self) -> list[dict]:
        return self.store.audit_rows()

    def verify(self) -> ChainStatus:
        prev = "0" * 64
        rows = self.rows()
        for r in rows:
            expected = _row_hash(prev, r["ts"], r["actor"], r["action"], r["target"],
                                 r["outcome"], r["details"])
            if r["prev_hash"] != prev or r["hash"] != expected:
                return ChainStatus(False, len(rows), r["seq"])
            prev = r["hash"]
        return ChainStatus(True, len(rows))

    def find(self, *, actor: str | None = None, action: str | None = None, outcome: str | None = None) -> list[dict]:
        out = []
        for r in self.rows():
            if actor and r["actor"] != actor:
                continue
            if action and r["action"] != action:
                continue
            if outcome and r["outcome"] != outcome:
                continue
            r = dict(r)
            r["details"] = json.loads(r["details"])
            out.append(r)
        return out
