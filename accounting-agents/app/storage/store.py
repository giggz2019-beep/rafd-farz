"""Persistence: one small schema that runs on PostgreSQL in production and
SQLite in tests.

Two tables:
- ``records``   — keyed JSON documents (approvals, jobs, idempotency results…).
- ``audit_log`` — append-only, hash-chained. There is no update or delete path
  for it anywhere in the code base; in production also REVOKE UPDATE, DELETE
  on it from the application role (see docs/SECURITY.md).
"""
from __future__ import annotations

import json
import threading
from datetime import date, datetime, timezone
from decimal import Decimal
from enum import Enum
from typing import Any

from sqlalchemy import (BigInteger, Column, DateTime, Integer, MetaData, String, Table, Text,
                        create_engine, insert, select, text, update)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import StaticPool

metadata = MetaData()

records = Table(
    "records", metadata,
    Column("kind", String(64), primary_key=True),
    Column("key", String(200), primary_key=True),
    Column("data", Text, nullable=False),
    Column("version", Integer, nullable=False, default=1),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
)

audit_log = Table(
    "audit_log", metadata,
    Column("seq", BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True),
    Column("ts", String(40), nullable=False),          # ISO-8601 UTC string: hashed verbatim
    Column("actor", String(64), nullable=False),
    Column("action", String(128), nullable=False),
    Column("target", String(256), nullable=False),
    Column("outcome", String(32), nullable=False),
    Column("details", Text, nullable=False),
    Column("prev_hash", String(64), nullable=False),
    Column("hash", String(64), nullable=False, unique=True),
)


def _default(o: Any):
    if isinstance(o, Decimal):
        return str(o)
    if isinstance(o, (date, datetime)):
        return o.isoformat()
    if isinstance(o, Enum):
        return o.value
    if hasattr(o, "__dataclass_fields__"):
        return {k: getattr(o, k) for k in o.__dataclass_fields__}
    raise TypeError(f"not JSON serialisable: {type(o).__name__}")


def dumps(obj: Any) -> str:
    """Canonical JSON: sorted keys, no whitespace — stable for hashing."""
    return json.dumps(obj, default=_default, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


class VersionConflict(RuntimeError):
    pass


class Store:
    def __init__(self, url: str = "sqlite+pysqlite:///:memory:", *, create_schema: bool | None = None):
        kwargs: dict[str, Any] = {"future": True}
        if url.startswith("sqlite"):
            kwargs.update(connect_args={"check_same_thread": False}, poolclass=StaticPool)
        self.engine = create_engine(url, **kwargs)
        self.is_postgres = self.engine.dialect.name == "postgresql"
        # On PostgreSQL the schema is created by `python -m app.storage.migrate` with an admin
        # role; the application role cannot create tables or alter the audit log.
        if create_schema if create_schema is not None else not self.is_postgres:
            metadata.create_all(self.engine)
        self._lock = threading.Lock()

    # ---- records -------------------------------------------------------
    def put(self, kind: str, key: str, data: dict, *, expected_version: int | None = None) -> int:
        now = datetime.now(timezone.utc)
        with self._lock, self.engine.begin() as cx:
            row = cx.execute(select(records.c.version).where(records.c.kind == kind, records.c.key == key)).first()
            if row is None:
                if expected_version not in (None, 0):
                    raise VersionConflict(f"{kind}/{key} does not exist")
                cx.execute(insert(records).values(kind=kind, key=key, data=dumps(data), version=1,
                                                  created_at=now, updated_at=now))
                return 1
            if expected_version is not None and row.version != expected_version:
                raise VersionConflict(f"{kind}/{key} is at v{row.version}, expected v{expected_version}")
            res = cx.execute(update(records)
                             .where(records.c.kind == kind, records.c.key == key, records.c.version == row.version)
                             .values(data=dumps(data), version=row.version + 1, updated_at=now))
            if res.rowcount != 1:
                raise VersionConflict(f"{kind}/{key} changed concurrently")
            return row.version + 1

    def put_if_absent(self, kind: str, key: str, data: dict) -> bool:
        now = datetime.now(timezone.utc)
        try:
            with self._lock, self.engine.begin() as cx:
                cx.execute(insert(records).values(kind=kind, key=key, data=dumps(data), version=1,
                                                  created_at=now, updated_at=now))
            return True
        except IntegrityError:
            return False

    def get(self, kind: str, key: str) -> dict | None:
        with self.engine.connect() as cx:
            row = cx.execute(select(records.c.data, records.c.version)
                             .where(records.c.kind == kind, records.c.key == key)).first()
        if row is None:
            return None
        d = json.loads(row.data)
        d["_version"] = row.version
        return d

    def list(self, kind: str) -> list[dict]:
        with self.engine.connect() as cx:
            rows = cx.execute(select(records.c.key, records.c.data, records.c.version)
                              .where(records.c.kind == kind).order_by(records.c.created_at, records.c.key)).all()
        out = []
        for r in rows:
            d = json.loads(r.data)
            d["_version"] = r.version
            out.append(d)
        return out

    # ---- audit log (append-only) ----------------------------------------
    def audit_append(self, build_row) -> dict:
        """``build_row(prev_hash) -> dict`` builds the row under a lock so the chain never forks."""
        with self._lock, self.engine.begin() as cx:
            if self.is_postgres:
                cx.execute(text("SELECT pg_advisory_xact_lock(727274)"))  # serialise writers across processes
            last = cx.execute(select(audit_log.c.hash).order_by(audit_log.c.seq.desc()).limit(1)).first()
            row = build_row(last.hash if last else "0" * 64)
            cx.execute(insert(audit_log).values(**row))
            return row

    def audit_rows(self) -> list[dict]:
        with self.engine.connect() as cx:
            rows = cx.execute(select(audit_log).order_by(audit_log.c.seq)).mappings().all()
        return [dict(r) for r in rows]
