"""Conflicting agent decisions, failed API requests, recovery after interruptions."""
import random

import httpx
import pytest

from app.daftra.adapter import (DaftraConfig, DaftraError, DaftraNotConfigured, DaftraUnavailable,
                                HttpDaftraAdapter, MockDaftraAdapter)
from app.llm.client import LLMError, LLMUnavailable
from app.orchestration.workflows import JobFailed
from app.security.permissions import Role

from .conftest import approve_opinion, expense_llm, make_purchase


# ---------------------------------------------------------------- conflicts
def test_audit_reject_overrides_confident_classifier(services, runner_factory):
    inv, acct = make_purchase(10, random.Random(10), services.documents)
    runner, _ = runner_factory({"ExpenseDecision": [expense_llm(acct, "high")]},
                               audit_responses={"AuditOpinion": [{"recommendation": "reject",
                                                                  "concerns": ["looks personal"]}]})
    r = runner.process_purchase_invoice("c", inv)
    d = r["done"]["finalize"]["decision"]
    assert r["status"] == "held_for_owner" and d["conflict"] is True
    assert not services.ledger.entries


def test_deterministic_blocker_beats_an_approving_llm(services, runner_factory):
    inv, acct = make_purchase(11, random.Random(11), services.documents)
    inv = {**inv, "document_id": None}
    runner, _ = runner_factory({"ExpenseDecision": [expense_llm(acct)]},
                               audit_responses={"AuditOpinion": [approve_opinion()]})
    assert runner.process_purchase_invoice("c2", inv)["status"] == "held_for_owner"


def test_manager_never_posts_its_own_preparation(services):
    from app.agents.roster import AccountingManagerAgent, AuditReport
    m = AccountingManagerAgent(services)
    d = m.decide_posting(AuditReport(blockers=[], warnings=[]), preparer_role=Role.ACCOUNTING_MANAGER,
                         classifier_needs_review=False, classifier_confidence="high")
    assert d.action == "hold_for_owner"


def test_llm_output_outside_the_schema_is_refused(services, runner_factory):
    inv, _ = make_purchase(12, random.Random(12), services.documents)
    runner, _ = runner_factory({"ExpenseDecision": [{**expense_llm(), "account_code": "4101"}]})   # revenue acct
    with pytest.raises(JobFailed, match="LLMError"):
        runner.process_purchase_invoice("bad", inv)
    assert not services.ledger.entries


# ---------------------------------------------------------------- failed requests
def _cfg(**kw):
    return DaftraConfig(base_url="https://tenant.example", journals_path="/journals", auth_header="X-Key",
                        api_key="k", **kw)


def test_daftra_not_configured_refuses_to_start():
    with pytest.raises(DaftraNotConfigured):
        HttpDaftraAdapter(DaftraConfig())


def test_daftra_retries_5xx_then_succeeds():
    calls = {"n": 0}

    def handler(req):
        calls["n"] += 1
        assert req.headers["X-Key"] == "k"
        return httpx.Response(503) if calls["n"] < 3 else httpx.Response(200, json={"data": [{"id": 1}]})
    a = HttpDaftraAdapter(_cfg(), transport=httpx.MockTransport(handler), sleep=lambda s: None)
    assert a.list_journals() == [{"id": 1}] and calls["n"] == 3


def test_daftra_gives_up_after_max_attempts_and_does_not_retry_4xx():
    a = HttpDaftraAdapter(_cfg(max_attempts=3), transport=httpx.MockTransport(lambda r: httpx.Response(500)),
                          sleep=lambda s: None)
    with pytest.raises(DaftraUnavailable):
        a.list_journals()
    seen = {"n": 0}

    def h(r):
        seen["n"] += 1
        return httpx.Response(401, text="bad key")
    b = HttpDaftraAdapter(_cfg(), transport=httpx.MockTransport(h), sleep=lambda s: None)
    with pytest.raises(DaftraError, match="401"):
        b.list_journals()
    assert seen["n"] == 1


def test_daftra_network_errors_are_retryable():
    def h(r):
        raise httpx.ConnectError("down")
    a = HttpDaftraAdapter(_cfg(max_attempts=2), transport=httpx.MockTransport(h), sleep=lambda s: None)
    with pytest.raises(DaftraUnavailable):
        a.get_journal("7")


def test_daftra_outage_through_the_gateway_is_audited(services):
    services.daftra = MockDaftraAdapter([{"id": 1}], fail_times=1)
    with pytest.raises(DaftraUnavailable):
        services.gateway.call(Role.FINANCIAL_ANALYST, "daftra.list_journals", {}, idempotency_key="d1")
    assert services.gateway.call(Role.FINANCIAL_ANALYST, "daftra.list_journals", {}, idempotency_key="d1") == [{"id": 1}]
    assert services.audit.find(action="tool.daftra.list_journals", outcome="failed")


# ---------------------------------------------------------------- recovery
def test_llm_outage_fails_the_job_and_a_rerun_completes_it(services, runner_factory):
    inv, acct = make_purchase(13, random.Random(13), services.documents)
    runner, llm = runner_factory({"ExpenseDecision": [LLMUnavailable("429"), expense_llm(acct)]})
    with pytest.raises(JobFailed, match="LLMUnavailable"):
        runner.process_purchase_invoice("r", inv)
    assert services.store.get("job", "r")["status"] == "failed"
    assert runner.process_purchase_invoice("r", inv)["status"] == "posted"
    job = services.store.get("job", "r")
    assert job["attempts"] == 2 and "vat" in job["done"]


def test_interruption_mid_job_resumes_without_repeating_work(services, runner_factory, monkeypatch):
    inv, acct = make_purchase(14, random.Random(14), services.documents)
    runner, llm = runner_factory({"ExpenseDecision": [expense_llm(acct)]})
    original = runner.a.audit.review
    monkeypatch.setattr(runner.a.audit, "review", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("power cut")))
    with pytest.raises(JobFailed):
        runner.process_purchase_invoice("i", inv)
    monkeypatch.setattr(runner.a.audit, "review", original)
    assert runner.process_purchase_invoice("i", inv)["status"] == "posted"
    assert len(llm.calls) == 1                         # classification was not paid for twice
    assert len(services.ledger.entries) == 1           # and nothing was posted twice
    assert runner.process_purchase_invoice("i", inv)["status"] == "posted"   # finished jobs are not re-run


def test_interrupted_gated_effect_is_not_blindly_repeated(services, runner_factory):
    inv, acct = make_purchase(15, random.Random(15), services.documents)
    runner, _ = runner_factory({"ExpenseDecision": [expense_llm(acct)]})
    runner.process_purchase_invoice("g", inv)
    bill = services.kv.list("payable")[0]
    from app.agents.roster import AccountsPayableAgent
    from app.orchestration.gateway import ApprovalRequired
    ap = AccountsPayableAgent(services)
    with pytest.raises(ApprovalRequired) as exc:
        ap.pay(bill["key"], bill["vendor"], bill["amount"], key="once")
    services.approvals.approve(exc.value.request.id, Role.OWNER)
    services.store.put_if_absent("tool_claim", "payables.execute_payment:once", {})   # crashed mid-payment
    with pytest.raises(RuntimeError, match="verify manually"):
        ap.pay(bill["key"], bill["vendor"], bill["amount"], key="once", approval_id=exc.value.request.id)
    assert services.kv.get("payable", bill["key"])["paid"] == "0.00"


def test_worker_recovery_requeues_interrupted_jobs(services, runner_factory):
    from app.api.queue import MemoryQueue
    from app.worker import recover
    inv, _ = make_purchase(16, random.Random(16), services.documents)
    services.store.put("job", "stuck", {"id": "stuck", "workflow": "purchase_invoice", "payload": {"invoice": inv},
                                        "status": "running", "done": {}, "attempts": 1})
    runner, _ = runner_factory({})
    q = MemoryQueue()
    assert recover(runner, q) == 1 and q.dequeue()["job_id"] == "stuck"
