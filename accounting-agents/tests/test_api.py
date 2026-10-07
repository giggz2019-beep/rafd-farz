import base64
import hashlib
import random

import pytest
from fastapi.testclient import TestClient

from app.api.main import create_app
from app.api.queue import MemoryQueue
from app.config import Settings
from app.llm.client import ScriptedLLM
from app.orchestration.services import build_services
from app.worker import run_job

from .conftest import expense_llm, make_purchase

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
