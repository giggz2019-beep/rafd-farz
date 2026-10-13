"""Immutable source-document store.

Source documents (invoices, receipts, bank statements) are content-addressed:
the id IS the SHA-256 of the bytes. Nothing in the system can overwrite or edit
one — a "correction" is a new document — and every read re-verifies the hash.
"""
from __future__ import annotations

import base64
import hashlib
from dataclasses import dataclass
from datetime import datetime, timezone

from ..storage.kv import KV, MemoryKV


class DocumentIntegrityError(RuntimeError):
    pass


@dataclass(frozen=True)
class SourceDocument:
    doc_id: str          # sha256 of content
    filename: str
    kind: str            # purchase_invoice | sales_invoice | bank_statement | receipt | contract
    received_at: datetime
    size: int


class DocumentStore:
    NS = "document"

    def __init__(self, kv: KV | None = None) -> None:
        self.kv = kv or MemoryKV()

    def add(self, content: bytes, filename: str, kind: str) -> SourceDocument:
        doc_id = hashlib.sha256(content).hexdigest()
        meta = SourceDocument(doc_id, filename, kind, datetime.now(timezone.utc), len(content))
        # insert-only: the same bytes are the same document and are never replaced
        self.kv.add(self.NS, doc_id, {"filename": filename, "kind": kind,
                                      "received_at": meta.received_at.isoformat(), "size": len(content),
                                      "content_b64": base64.b64encode(content).decode()})
        return self.meta(doc_id)

    def get(self, doc_id: str) -> bytes:
        d = self.kv.get(self.NS, doc_id)
        if d is None:
            raise KeyError(doc_id)
        blob = base64.b64decode(d["content_b64"])
        if hashlib.sha256(blob).hexdigest() != doc_id:
            raise DocumentIntegrityError(f"document {doc_id} failed its integrity check")
        return blob

    def meta(self, doc_id: str) -> SourceDocument | None:
        d = self.kv.get(self.NS, doc_id)
        if d is None:
            return None
        return SourceDocument(doc_id, d["filename"], d["kind"], datetime.fromisoformat(d["received_at"]), d["size"])

    def exists(self, doc_id: str) -> bool:
        return self.kv.get(self.NS, doc_id) is not None
