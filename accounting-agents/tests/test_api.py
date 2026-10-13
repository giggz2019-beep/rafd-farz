import base64
import hashlib
import random
from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.agents.roster import AccountsPayableAgent
from app.api.main import create_app
from app.api.queue import MemoryQueue
from app.config import Settings
from app.core.invoices import Direction, Invoice, InvoiceLine
from app.core.serde import invoice_to_dict
from app.llm.client import ScriptedLLM
from app.orchestration.services import build_services
from app.worker import run_job

from .conftest import approve_vendor, expense_llm, make_purchase

OWNER, SERVICE = "owner-secret-token", "service-secret-token"


@pytest.fixture
def ctx():
    settings = Settings(owner_token_sha256=hashlib.sha256(OWNER.encode()).hexdigest(),
                        service_token_sha256=hashlib.sha256(SERVICE.encode()).hexdigest())
    services = build_services(settings)
    q = MemoryQueue()
    llm = ScriptedLLM({"ExpenseDecision": [expense_llm("5101", "low")],
                       "AuditOpinion": [{"recommendation": "approve", "concerns": []}]})
    app = create_app(settings, services=services, llm=llm, queue=q)
    return TestClient(app), services, q, app


def h(token):
    return {"Authorization": f"Bearer {token}"}


def test_health_is_public_and_reports_writes_off(ctx):
    c, *_ = ctx
    assert c.get("/health").json()["daftra_writes_enabled"] is False


def test_tokens_are_not_interchangeable(ctx):
    c, *_ = ctx
    assert c.get("/api/approvals").status_code == 401
    assert c.get("/api/approvals", headers=h(SERVICE)).status_code == 401
    assert c.post("/api/documents", headers=h(OWNER),
                  json={"filename": "a", "kind": "receipt", "content_base64": "YQ=="}).status_code == 401


def test_end_to_end_ingest_hold_and_owner_approval(ctx):
    c, services, q, app = ctx
    content = b"%PDF fake invoice"
    r = c.post("/api/documents", headers=h(SERVICE), json={"filename": "i.pdf", "kind": "purchase_invoice",
                                                           "content_base64": base64.b64encode(content).decode()})
    doc_id = r.json()["document_id"]
    inv, _ = make_purchase(0, random.Random(0), services.documents)
    inv["document_id"] = doc_id
    assert c.post("/api/jobs/purchase-invoice", headers=h(SERVICE), json={"job_id": "j1", "invoice": inv}).json()["queued"]
    run_job(app.state.runner, q.dequeue())                       # what the worker does
    pending = c.get("/api/approvals", headers=h(OWNER)).json()
    assert len(pending) == 1 and not services.ledger.entries     # low confidence → held
    out = c.post(f"/api/approvals/{pending[0]['id']}/approve", headers=h(OWNER), json={"reason": "checked"}).json()
    assert out["job"] == "posted" and len(services.ledger.entries) == 1
    assert c.get("/api/audit/verify", headers=h(OWNER)).json()["ok"] is True
    assert c.post(f"/api/approvals/{pending[0]['id']}/approve", headers=h(OWNER), json={}).status_code == 409


def test_rejection_requires_reason_and_bad_input_is_refused(ctx):
    c, *_ = ctx
    assert c.post("/api/documents", headers=h(SERVICE),
                  json={"filename": "a", "kind": "r", "content_base64": "%%%"}).status_code == 422
    assert c.post("/api/documents", headers=h(SERVICE),
                  json={"filename": "a", "kind": "r", "content_base64": "YQ==", "extra": 1}).status_code == 422


def test_offline_eval_harness_is_consistent():
    from app.evals.run import main
    assert main([]) == 0


def _approve(c, approval_id):
    return c.post(f"/api/approvals/{approval_id}/approve", headers=h(OWNER), json={"reason": "ok"})


def test_purchasing_flow_through_the_api(ctx):
    c, services, q, app = ctx
    r = c.post("/api/vendors", headers=h(SERVICE), json={"name": "Camera Supplier"}).json()
    assert r["status"] == "awaiting_owner" and not services.kv.list("vendor")
    assert c.post(f"/api/approvals/{r['approval_id']}/approve", headers=h(SERVICE), json={}).status_code == 401
    assert _approve(c, r["approval_id"]).json()["executed"]["vendor_key"]
    assert [v["name"] for v in services.kv.list("vendor")] == ["Camera Supplier"]

    po = c.post("/api/purchase-orders", headers=h(SERVICE),
                json={"request_id": "r1", "vendor": "Camera Supplier", "amount": "5000", "description": "cameras"}).json()
    po_id = _approve(c, po["approval_id"]).json()["executed"]["po_id"]
    rc = c.post(f"/api/purchase-orders/{po_id}/receipts", headers=h(SERVICE),
                json={"receipt_id": "g1", "received_on": "2026-03-01", "note": "delivered"}).json()
    assert rc["status"] == "done" and services.kv.get("purchase_order", po_id)["receipts"]


def test_payment_request_is_executed_only_after_owner_approval(ctx):
    c, services, q, app = ctx
    approve_vendor(services, "Office Supplies")
    doc = services.documents.add(b"bill", "b.pdf", "purchase_invoice")
    inv = invoice_to_dict(Invoice(Direction.PURCHASE, "B-1", date(2026, 3, 1), "Office Supplies",
                                  (InvoiceLine("paper", Decimal(1), Decimal("500")),), document_id=doc.doc_id))
    key = AccountsPayableAgent(services).register(inv, key="reg")["key"]
    r = c.post("/api/payment-requests", headers=h(SERVICE),
               json={"request_id": "p1", "payable_key": key, "amount": "500.00"}).json()
    assert r["status"] == "awaiting_owner" and services.kv.get("payable", key)["paid"] == "0.00"
    assert _approve(c, r["approval_id"]).json()["executed"]["status"] == "instruction_recorded"
    assert services.kv.get("payable", key)["paid"] == "500.00"
    again = c.post("/api/payment-requests", headers=h(SERVICE),
                   json={"request_id": "p2", "payable_key": key, "amount": "1.00"})
    assert again.status_code == 409                              # nothing left to pay


def test_purchase_order_for_unapproved_vendor_fails_after_approval(ctx):
    c, services, *_ = ctx
    po = c.post("/api/purchase-orders", headers=h(SERVICE),
                json={"request_id": "x", "vendor": "Ghost Ltd", "amount": "9000", "description": "?"}).json()
    r = _approve(c, po["approval_id"])
    assert r.status_code == 409 and "approve the vendor" in r.json()["detail"]
    assert not services.kv.list("purchase_order")
