"""Owner approval gates.

An approval binds three things together: the operation, the exact payload
(by SHA-256), and the agent that asked. An approved request can be consumed
once, only by the operation and payload it was issued for — approving
"pay vendor A 1,000" can never be replayed as "pay vendor B 9,000".
"""
from __future__ import annotations

import hashlib
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum

from ..storage.store import Store, VersionConflict, dumps
from .audit import AuditLog
from .permissions import Op, Role, require


class Status(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    EXECUTED = "executed"
    EXPIRED = "expired"


class ApprovalError(RuntimeError):
    pass


def payload_hash(payload: dict) -> str:
    return hashlib.sha256(dumps(payload).encode()).hexdigest()


@dataclass
class ApprovalRequest:
    id: str
    operation: str
    requested_by: str
    summary: str
    payload: dict
    payload_hash: str
    idempotency_key: str
    status: str
    created_at: str
    expires_at: str
    decided_by: str | None = None
    decided_at: str | None = None
    reason: str | None = None


class ApprovalService:
    KIND = "approval"
    IDEM = "approval_idem"

    def __init__(self, store: Store, audit: AuditLog, ttl: timedelta = timedelta(days=7)):
        self.store, self.audit, self.ttl = store, audit, ttl

    def request(self, op: Op, requested_by: Role, payload: dict, summary: str, idempotency_key: str) -> ApprovalRequest:
        require(requested_by, Op.REQUEST_APPROVAL)
        require(requested_by, op)                      # you can only ask to do what your role covers
        existing = self.store.get(self.IDEM, idempotency_key)
        if existing:
            return self.get(existing["id"])
        now = datetime.now(timezone.utc)
        req = ApprovalRequest(str(uuid.uuid4()), op.value, requested_by.value, summary, payload,
                              payload_hash(payload), idempotency_key, Status.PENDING.value,
                              now.isoformat(), (now + self.ttl).isoformat())
        if not self.store.put_if_absent(self.IDEM, idempotency_key, {"id": req.id}):
            return self.get(self.store.get(self.IDEM, idempotency_key)["id"])
        self.store.put(self.KIND, req.id, asdict(req))
        self.audit.record(requested_by.value, "approval.requested", req.id, "pending",
                          {"operation": op.value, "summary": summary, "payload_hash": req.payload_hash})
        return req

    def get(self, approval_id: str) -> ApprovalRequest:
        d = self.store.get(self.KIND, approval_id)
        if not d:
            raise ApprovalError(f"approval {approval_id} not found")
        d.pop("_version", None)
        req = ApprovalRequest(**d)
        if req.status in (Status.PENDING.value, Status.APPROVED.value) and \
                datetime.fromisoformat(req.expires_at) < datetime.now(timezone.utc):
            req.status = Status.EXPIRED.value
        return req

    def pending(self) -> list[ApprovalRequest]:
        out = []
        for d in self.store.list(self.KIND):
            r = self.get(d["id"])
            if r.status == Status.PENDING.value:
                out.append(r)
        return out

    def _decide(self, approval_id: str, actor: Role, new_status: Status, reason: str | None) -> ApprovalRequest:
        require(actor, Op.APPROVE)                     # only the owner role holds APPROVE
        raw = self.store.get(self.KIND, approval_id)
        req = self.get(approval_id)
        if req.status != Status.PENDING.value:
            raise ApprovalError(f"approval {approval_id} is {req.status}, not pending")
        req.status, req.decided_by = new_status.value, actor.value
        req.decided_at, req.reason = datetime.now(timezone.utc).isoformat(), reason
        try:
            self.store.put(self.KIND, req.id, asdict(req), expected_version=raw["_version"])
        except VersionConflict as exc:
            raise ApprovalError("approval changed while deciding; reload and retry") from exc
        self.audit.record(actor.value, f"approval.{new_status.value}", req.id, new_status.value,
                          {"operation": req.operation, "reason": reason})
        return req

    def approve(self, approval_id: str, actor: Role, reason: str | None = None) -> ApprovalRequest:
        return self._decide(approval_id, actor, Status.APPROVED, reason)

    def reject(self, approval_id: str, actor: Role, reason: str) -> ApprovalRequest:
        if not reason or not reason.strip():
            raise ApprovalError("a rejection needs a reason")
        return self._decide(approval_id, actor, Status.REJECTED, reason)

    def consume(self, approval_id: str, op: Op, payload: dict, executor: Role) -> ApprovalRequest:
        """Single-use: verify the approval matches this exact operation + payload, then mark executed."""
        raw = self.store.get(self.KIND, approval_id)
        req = self.get(approval_id)
        problem = None
        if req.status != Status.APPROVED.value:
            problem = f"approval is {req.status}"
        elif req.operation != op.value:
            problem = f"approval is for {req.operation}, not {op.value}"
        elif req.payload_hash != payload_hash(payload):
            problem = "payload differs from what the owner approved"
        if problem:
            self.audit.record(executor.value, "approval.consume", approval_id, "denied", {"reason": problem})
            raise ApprovalError(problem)
        req.status = Status.EXECUTED.value
        try:
            self.store.put(self.KIND, req.id, asdict(req), expected_version=raw["_version"])
        except VersionConflict as exc:
            raise ApprovalError("approval already used") from exc
        self.audit.record(executor.value, "approval.consume", approval_id, "executed", {"operation": op.value})
        return req
