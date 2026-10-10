"""HTTP API and owner approval dashboard.

Two bearer tokens, stored only as SHA-256 hashes in the environment:
- owner token   → read the queue, approve/reject, read and verify the audit log;
- service token → upload documents and submit jobs (n8n, the Telegram bot…).
Neither token can do the other's job. Approving is never exposed to the service token.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, ConfigDict

from ..config import Settings
from ..llm.client import ClaudeLLM, LLM
from ..orchestration.services import Services, build_services
from ..orchestration.gateway import ApprovalRequired
from ..orchestration.workflows import Agents, JobFailed, JobRunner
from ..security.approvals import ApprovalError
from ..security.permissions import APPROVAL_REQUIRED, Op, Role
from .queue import JobQueue, make_queue

DASHBOARD = Path(__file__).parent / "dashboard.html"


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DocumentIn(_In):
    filename: str
    kind: str
    content_base64: str


class InvoiceJobIn(_In):
    job_id: str
    invoice: dict
    context: dict = {}


class DecisionIn(_In):
    reason: str | None = None


class VendorIn(_In):
    name: str
    vat_number: str | None = None
    standing_limit: str | None = None       # per-invoice limit for a recurring supplier, SAR


class PurchaseOrderIn(_In):
    request_id: str                          # caller's id; makes a retry safe
    vendor: str
    amount: str
    description: str


class ReceiptIn(_In):
    receipt_id: str
    received_on: str
    note: str = ""
    document_id: str | None = None


class PaymentRequestIn(_In):
    request_id: str
    payable_key: str
    amount: str


def _check(token: str | None, expected_sha256: str) -> bool:
    if not token or not expected_sha256:
        return False
    return hmac.compare_digest(hashlib.sha256(token.encode()).hexdigest(), expected_sha256.lower())


def create_app(settings: Settings | None = None, *, services: Services | None = None,
               llm: LLM | None = None, queue: JobQueue | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    services = services or build_services(settings)
    if llm is None and settings.anthropic_api_key:
        llm = ClaudeLLM(settings.anthropic_api_key, settings.claude_model, use_fallbacks=settings.claude_fallbacks)
    runner = JobRunner(services, Agents.build(services, llm))
    queue = queue or make_queue(settings)
    app = FastAPI(title="RAFD AI Accounting", docs_url=None, redoc_url=None)
    app.state.services, app.state.runner, app.state.queue = services, runner, queue

    def bearer(authorization: str | None) -> str | None:
        if authorization and authorization.lower().startswith("bearer "):
            return authorization[7:].strip()
        return None

    def owner(authorization: str | None = Header(default=None)) -> Role:
        if not _check(bearer(authorization), settings.owner_token_sha256):
            services.audit.record("api", "auth", "owner", "denied", {})
            raise HTTPException(401, "owner token required")
        return Role.OWNER

    def service(authorization: str | None = Header(default=None)) -> str:
        if not _check(bearer(authorization), settings.service_token_sha256):
            services.audit.record("api", "auth", "service", "denied", {})
            raise HTTPException(401, "service token required")
        return "service"

    @app.get("/health")
    def health():
        return {"ok": True, "daftra_writes_enabled": settings.daftra_writes_enabled,
                "llm_configured": llm is not None, "vat_registered": settings.company_vat_registered}

    @app.get("/", response_class=HTMLResponse)
    def dashboard():
        return DASHBOARD.read_text(encoding="utf-8")

    # ---------------- service: ingestion ----------------
    @app.post("/api/documents")
    def upload(doc: DocumentIn, _: str = Depends(service)):
        try:
            content = base64.b64decode(doc.content_base64, validate=True)
        except (binascii.Error, ValueError):
            raise HTTPException(422, "content_base64 is not valid base64")
        if len(content) > 15 * 1024 * 1024:
            raise HTTPException(413, "document larger than 15 MB")
        meta = services.documents.add(content, doc.filename, doc.kind)
        services.audit.record("service", "document.added", meta.doc_id, "stored", {"filename": doc.filename})
        return {"document_id": meta.doc_id}

    @app.post("/api/jobs/{kind}")
    def submit(kind: str, body: InvoiceJobIn, _: str = Depends(service)):
        if kind not in ("purchase-invoice", "sales-invoice"):
            raise HTTPException(404, "unknown job kind")
        queue.enqueue({"kind": kind, "job_id": body.job_id, "invoice": body.invoice, "context": body.context})
        services.audit.record("service", "job.submitted", body.job_id, "queued", {"kind": kind})
        return {"job_id": body.job_id, "queued": True}

    # ---------------- service: purchasing (each one waits for the owner) ----------------
    def _awaiting(call) -> dict:
        try:
            out = call()
        except ApprovalRequired as exc:
            return {"status": "awaiting_owner", "approval_id": exc.request.id, "summary": exc.request.summary}
        except ValueError as exc:
            raise HTTPException(409, str(exc))
        return {"status": "done", "result": out}

    @app.post("/api/vendors")
    def request_vendor(body: VendorIn, _: str = Depends(service)):
        return _awaiting(lambda: runner.a.ap.add_vendor(body.name, body.vat_number, body.standing_limit,
                                                         key=f"vendor:{body.name.strip().casefold()}"))

    @app.post("/api/purchase-orders")
    def request_po(body: PurchaseOrderIn, _: str = Depends(service)):
        return _awaiting(lambda: runner.a.ap.raise_order(body.vendor, body.amount, body.description,
                                                          key=f"po:{body.request_id}"))

    @app.post("/api/purchase-orders/{po_id}/receipts")
    def receipt(po_id: str, body: ReceiptIn, _: str = Depends(service)):
        return _awaiting(lambda: runner.a.ap.record_receipt(po_id, body.received_on, body.note, body.document_id,
                                                             key=f"receipt:{body.receipt_id}"))

    @app.post("/api/payment-requests")
    def request_payment(body: PaymentRequestIn, _: str = Depends(service)):
        # Accounts Payable raises the request; the Accounting Manager executes it once the owner approves.
        def run():
            req = runner.a.ap.request_payment(body.payable_key, body.amount, key=f"payreq:{body.request_id}")
            return runner.a.manager.execute_payment(req, key=f"pay:{body.request_id}")
        return _awaiting(run)

    # ---------------- owner ----------------
    @app.get("/api/approvals")
    def approvals(_: Role = Depends(owner)):
        return [r.__dict__ for r in services.approvals.pending()]

    @app.post("/api/approvals/{approval_id}/approve")
    def approve(approval_id: str, body: DecisionIn, actor: Role = Depends(owner)):
        try:
            req = services.approvals.approve(approval_id, actor, body.reason)
        except ApprovalError as exc:
            raise HTTPException(409, str(exc))
        result: dict = {"approval": req.__dict__}
        # A held journal entry is posted straight away. Any other gated operation is carried out now by
        # the agent that asked for it, with exactly the payload the owner saw.
        if req.operation == Op.POST_TO_STAGING_LEDGER.value and req.idempotency_key.endswith(":review"):
            job_id = req.idempotency_key[: -len(":review")]
            try:
                result["job"] = runner.resume_after_review(job_id, approval_id)["status"]
            except (JobFailed, ApprovalError) as exc:
                raise HTTPException(409, str(exc))
        elif Op(req.operation) in APPROVAL_REQUIRED:
            tool, _, key = req.idempotency_key.partition(":")
            try:
                result["executed"] = services.gateway.call(Role(req.requested_by), tool, req.payload,
                                                           idempotency_key=key, approval_id=approval_id)
            except (ApprovalError, ValueError, RuntimeError) as exc:
                raise HTTPException(409, f"approved, but not carried out: {exc}")
        return result

    @app.post("/api/approvals/{approval_id}/reject")
    def reject(approval_id: str, body: DecisionIn, actor: Role = Depends(owner)):
        try:
            return services.approvals.reject(approval_id, actor, body.reason or "").__dict__
        except ApprovalError as exc:
            raise HTTPException(409, str(exc))

    @app.get("/api/jobs/{job_id}")
    def job(job_id: str, _: Role = Depends(owner)):
        j = services.store.get("job", job_id)
        if not j:
            raise HTTPException(404, "no such job")
        return j

    @app.get("/api/audit")
    def audit(limit: int = 200, _: Role = Depends(owner)):
        rows = services.audit.rows()[-max(1, min(limit, 2000)):]
        return rows

    @app.get("/api/audit/verify")
    def verify(_: Role = Depends(owner)):
        return services.audit.verify().__dict__

    @app.get("/api/reports/financials")
    def financials(_: Role = Depends(owner)):
        dr, cr = services.ledger.trial_balance()
        return {"trial_balance": {"debit": str(dr), "credit": str(cr)},
                "balances": {k: str(v) for k, v in services.ledger.balances().items()}}

    return app
