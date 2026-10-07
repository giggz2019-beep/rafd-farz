"""Accounting workflows with durable, resumable checkpoints.

A job is a list of named steps. After each step its result is stored; a job
restarted after a crash skips completed steps and, because every tool call is
keyed by ``<job_id>:<step>``, a step that crashed half-way replays its finished
tool calls from the idempotency store instead of repeating them.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from ..agents.roster import (AccountingManagerAgent, AccountsPayableAgent, AccountsReceivableAgent,
                             AuditReport, ExpenseAccountantAgent, InternalAuditAgent, ManagerDecision,
                             RevenueAccountantAgent, VatAccountantAgent)
from ..llm.client import LLM
from ..security.permissions import Op, Role
from .gateway import ApprovalRequired
from .services import Services


class JobFailed(RuntimeError):
    pass


@dataclass
class Agents:
    manager: AccountingManagerAgent
    revenue: RevenueAccountantAgent
    expense: ExpenseAccountantAgent
    ar: AccountsReceivableAgent
    ap: AccountsPayableAgent
    vat: VatAccountantAgent
    audit: InternalAuditAgent

    @classmethod
    def build(cls, s: Services, llm: LLM | None, *, audit_llm: LLM | None = None) -> "Agents":
        return cls(AccountingManagerAgent(s, llm), RevenueAccountantAgent(s, llm), ExpenseAccountantAgent(s, llm),
                   AccountsReceivableAgent(s, llm), AccountsPayableAgent(s, llm), VatAccountantAgent(s, llm),
                   InternalAuditAgent(s, audit_llm if audit_llm is not None else llm))


class JobRunner:
    KIND = "job"

    def __init__(self, services: Services, agents: Agents):
        self.s, self.a = services, agents

    # ------------------------------------------------------------------ engine
    def _run(self, job_id: str, workflow: str, payload: dict, steps: list[tuple[str, Callable[[dict], object]]]) -> dict:
        job = self.s.store.get(self.KIND, job_id) or {"id": job_id, "workflow": workflow, "payload": payload,
                                                       "status": "running", "done": {}, "attempts": 0}
        if job["status"] in ("posted", "rejected", "held_for_owner", "completed"):
            return job
        job.pop("_version", None)
        job["attempts"] += 1
        job["status"] = "running"
        self.s.store.put(self.KIND, job_id, job)
        ctx = {"job_id": job_id, "payload": job["payload"], **job["done"]}
        for name, fn in steps:
            if name in job["done"]:
                continue
            try:
                result = fn(ctx)
            except Exception as exc:
                job["status"], job["error"] = "failed", f"{name}: {type(exc).__name__}: {exc}"
                self.s.store.put(self.KIND, job_id, job)
                self.s.audit.record("orchestrator", f"job.{workflow}", job_id, "failed", {"step": name,
                                                                                         "error": job["error"]})
                raise JobFailed(job["error"]) from exc
            job["done"][name] = result
            ctx[name] = result
            self.s.store.put(self.KIND, job_id, job)
            if isinstance(result, dict) and result.get("stop"):
                job["status"] = result["status"]
                break
        else:
            job["status"] = "completed"
        job.pop("error", None)
        self.s.store.put(self.KIND, job_id, job)
        self.s.audit.record("orchestrator", f"job.{workflow}", job_id, job["status"], {})
        return job

    # ------------------------------------------------------------------ shared tail
    def _finalize(self, ctx: dict, *, preparer: Role, classifier) -> dict:
        audit = AuditReport.model_validate(ctx["audit"])
        decision: ManagerDecision = self.a.manager.decide_posting(
            audit, preparer_role=preparer,
            classifier_needs_review=classifier.get("needs_human_review", False),
            classifier_confidence=classifier.get("confidence"))
        out = {"decision": decision.model_dump(), "stop": True}
        jid = ctx["job_id"]
        if decision.action == "post":
            r = self.a.manager.tool("ledger.post_staging", {"entry": ctx["entry"]}, key=f"{jid}:post")
            out.update(status="posted", fingerprint=r["fingerprint"])
        elif decision.action == "reject":
            out.update(status="rejected")
        else:
            req = self.s.approvals.request(Op.POST_TO_STAGING_LEDGER, Role.ACCOUNTING_MANAGER,
                                           {"entry": ctx["entry"]},
                                           "Review held entry: " + "; ".join(decision.reasons)[:400],
                                           idempotency_key=f"{jid}:review")
            out.update(status="held_for_owner", approval_id=req.id)
        return out

    # ------------------------------------------------------------------ workflows
    def process_purchase_invoice(self, job_id: str, invoice: dict) -> dict:
        a = self.a

        def classify(ctx):
            d, entry = a.expense.propose(ctx["payload"]["invoice"], key=f"{job_id}:classify")
            return {"decision": d.model_dump(), "entry": entry}

        steps = [
            ("vat", lambda ctx: {"issues": a.vat.validate(ctx["payload"]["invoice"], key=f"{job_id}:vat")}),
            ("classify", classify),
            ("entry", lambda ctx: ctx["classify"]["entry"]),
            ("audit", lambda ctx: a.audit.review(ctx["payload"]["invoice"], ctx["entry"], ctx["vat"]["issues"],
                                                 key=f"{job_id}:audit").model_dump()),
            ("register", lambda ctx: {"skipped": True} if ctx["audit"]["blockers"] else
                a.ap.register(ctx["payload"]["invoice"], key=f"{job_id}:register")),
            ("finalize", lambda ctx: self._finalize(ctx, preparer=Role.EXPENSE_ACCOUNTANT,
                                                    classifier=ctx["classify"]["decision"])),
        ]
        return self._run(job_id, "purchase_invoice", {"invoice": invoice}, steps)

    def process_sales_invoice(self, job_id: str, invoice: dict, context: dict | None = None) -> dict:
        a = self.a

        def recognise(ctx):
            d, entry = a.revenue.propose(ctx["payload"]["invoice"], ctx["payload"]["context"], key=f"{job_id}:revenue")
            return {"decision": d.model_dump(), "entry": entry}

        steps = [
            ("vat", lambda ctx: {"issues": a.vat.validate(ctx["payload"]["invoice"], key=f"{job_id}:vat")}),
            ("revenue", recognise),
            ("entry", lambda ctx: ctx["revenue"]["entry"]),
            ("audit", lambda ctx: a.audit.review(ctx["payload"]["invoice"], ctx["entry"], ctx["vat"]["issues"],
                                                 key=f"{job_id}:audit").model_dump()),
            ("register", lambda ctx: {"skipped": True} if ctx["audit"]["blockers"] else
                a.ar.register(ctx["payload"]["invoice"], key=f"{job_id}:register")),
            ("finalize", lambda ctx: self._finalize(ctx, preparer=Role.REVENUE_ACCOUNTANT,
                                                    classifier={**ctx["revenue"]["decision"], "confidence": None})),
        ]
        return self._run(job_id, "sales_invoice", {"invoice": invoice, "context": context or {}}, steps)

    def resume_after_review(self, job_id: str, approval_id: str) -> dict:
        """The owner approved a held entry: the manager posts it, consuming that approval."""
        job = self.s.store.get(self.KIND, job_id)
        if not job or job["status"] != "held_for_owner":
            raise JobFailed(f"job {job_id} is not waiting for the owner")
        entry = job["done"]["entry"]
        r = self.a.manager.tool("ledger.post_staging", {"entry": entry}, key=f"{job_id}:post",
                                approval_id=approval_id)
        job.pop("_version", None)
        job["status"], job["done"]["finalize"]["fingerprint"] = "posted", r["fingerprint"]
        self.s.store.put(self.KIND, job_id, job)
        self.s.audit.record("orchestrator", "job.resume", job_id, "posted", {"approval_id": approval_id})
        return job


__all__ = ["Agents", "JobRunner", "JobFailed", "ApprovalRequired"]
