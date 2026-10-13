"""ToolGateway: the only path from an agent to an effect.

Every call goes through four gates, in order, and every outcome is audited:
1. the tool exists;
2. the calling role holds the tool's Operation (RBAC);
3. idempotency — a repeated key returns the stored result instead of re-running;
4. for approval-gated operations, a matching, unused owner approval.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable

from ..security.approvals import ApprovalRequest, ApprovalService
from ..security.audit import AuditLog
from ..security.permissions import APPROVAL_REQUIRED, Op, PermissionDenied, Role, require
from ..storage.store import Store, dumps


class UnknownTool(KeyError):
    pass


class ApprovalRequired(RuntimeError):
    def __init__(self, request: ApprovalRequest):
        super().__init__(f"owner approval required ({request.operation}): approval id {request.id}")
        self.request = request


@dataclass(frozen=True)
class Tool:
    name: str
    op: Op
    func: Callable[[dict], Any]
    description: str = ""
    summarize: Callable[[dict], str] | None = None   # one line shown to the owner when approval is needed


class ToolGateway:
    IDEM = "tool_result"

    def __init__(self, store: Store, audit: AuditLog, approvals: ApprovalService):
        self.store, self.audit, self.approvals = store, audit, approvals
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        if tool.name in self._tools:
            raise ValueError(f"tool {tool.name} already registered")
        self._tools[tool.name] = tool

    def tool(self, name: str) -> Tool:
        if name not in self._tools:
            raise UnknownTool(name)
        return self._tools[name]

    def call(self, role: Role, name: str, payload: dict, *, idempotency_key: str,
             approval_id: str | None = None) -> Any:
        tool = self.tool(name)
        try:
            require(role, tool.op)
        except PermissionDenied:
            self.audit.record(role.value, f"tool.{name}", idempotency_key, "denied",
                              {"reason": "rbac", "operation": tool.op.value})
            raise

        idem = f"{name}:{idempotency_key}"
        prior = self.store.get(self.IDEM, idem)
        if prior is not None:
            self.audit.record(role.value, f"tool.{name}", idempotency_key, "replayed", {})
            return prior["result"]

        gated = tool.op in APPROVAL_REQUIRED
        if gated and approval_id is None:
            summary = tool.summarize(payload) if tool.summarize else f"{name}"
            req = self.approvals.request(tool.op, role, payload, summary, idempotency_key=idem)
            self.audit.record(role.value, f"tool.{name}", idempotency_key, "awaiting_approval",
                              {"approval_id": req.id})
            raise ApprovalRequired(req)
        if approval_id is not None:                      # also honours approvals on non-gated ops (owner reviews)
            self.approvals.consume(approval_id, tool.op, payload, role)

        if gated and not self.store.put_if_absent("tool_claim", idem, {"approval_id": approval_id}):
            # A previous attempt started this effect and never recorded a result (crash mid-call).
            # Re-running could pay twice, so stop and leave it for a human to check.
            self.audit.record(role.value, f"tool.{name}", idempotency_key, "blocked",
                              {"reason": "in-flight or interrupted gated call; manual check required"})
            raise RuntimeError(f"{name} with key {idempotency_key} was started before and has no recorded "
                               f"result; verify manually before retrying")
        try:
            result = tool.func(payload)
        except Exception as exc:
            self.audit.record(role.value, f"tool.{name}", idempotency_key, "failed",
                              {"error": type(exc).__name__, "message": str(exc)[:500]})
            raise
        stored = json.loads(dumps(result))               # store exactly what a replay will return
        self.store.put_if_absent(self.IDEM, idem, {"result": stored})
        self.audit.record(role.value, f"tool.{name}", idempotency_key, "executed",
                          {"approval_id": approval_id} if approval_id else {})
        return stored
