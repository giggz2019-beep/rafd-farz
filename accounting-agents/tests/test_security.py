"""RBAC, approval gates, audit-log integrity."""
import random

import pytest
from sqlalchemy import text

from app.agents.base import ToolNotAllowed
from app.agents.roster import ALL_AGENTS, AccountingManagerAgent, AccountsPayableAgent
from app.daftra.adapter import WritesDisabled
from app.orchestration.gateway import ApprovalRequired
from app.security.approvals import ApprovalError
from app.security.permissions import APPROVAL_REQUIRED, PERMISSIONS, Op, PermissionDenied, Role

from .conftest import expense_llm, make_purchase


def test_exactly_ten_agents_with_distinct_roles_and_prompts():
    assert len(ALL_AGENTS) == 10
    roles = {a.spec.role for a in ALL_AGENTS}
    assert len(roles) == 10 and Role.OWNER not in roles
    for a in ALL_AGENTS:
        assert a.spec.prompt_path.exists() and len(a.spec.prompt_path.read_text()) > 200


def test_every_agent_toolset_is_within_its_permissions(services):
    for cls in ALL_AGENTS:
        cls(services)        # constructor raises ToolNotAllowed on any mismatch


def test_no_agent_can_approve():
    for role, ops in PERMISSIONS.items():
        assert (Op.APPROVE in ops) == (role == Role.OWNER)


@pytest.mark.parametrize("cls", ALL_AGENTS)
def test_agent_cannot_call_any_tool_outside_its_set(services, cls):
    agent = cls(services)
    for name in services.gateway._tools:
        if name in agent.spec.tools:
            continue
        with pytest.raises(ToolNotAllowed):
            agent.tool(name, {}, key=f"probe-{name}")


def test_gateway_enforces_rbac_even_if_agent_layer_is_bypassed(services):
    with pytest.raises(PermissionDenied):
        services.gateway.call(Role.EXPENSE_ACCOUNTANT, "ledger.post_staging", {"entry": {}}, idempotency_key="x")
    with pytest.raises(PermissionDenied):
        services.gateway.call(Role.INTERNAL_AUDIT, "payables.execute_payment", {}, idempotency_key="y")
    denied = services.audit.find(outcome="denied")
    assert {d["actor"] for d in denied} == {"expense_accountant", "internal_audit"}


def _payable(services, runner_factory):
    inv, acct = make_purchase(7, random.Random(7), services.documents)
    runner, _ = runner_factory({"ExpenseDecision": [expense_llm(acct)]})
    runner.process_purchase_invoice("p", inv)
    return services.kv.list("payable")[0]


def _pay(services, bill, amount, key, approval_id=None, req_key=None):
    """AP raises the request; the manager executes it; the owner approves in between."""
    req = AccountsPayableAgent(services).request_payment(bill["key"], amount, key=req_key or f"{key}:req")
    return AccountingManagerAgent(services).execute_payment(req, key=key, approval_id=approval_id)


def test_payment_requires_owner_approval_and_is_single_use(services, runner_factory):
    bill = _payable(services, runner_factory)
    with pytest.raises(ApprovalRequired) as exc:
        _pay(services, bill, "10.00", "pay-1")
    req = exc.value.request
    with pytest.raises(PermissionDenied):                         # agents cannot approve
        services.approvals.approve(req.id, Role.ACCOUNTING_MANAGER)
    with pytest.raises(ApprovalError):                            # not yet approved
        _pay(services, bill, "10.00", "pay-1", approval_id=req.id)
    services.approvals.approve(req.id, Role.OWNER)
    assert _pay(services, bill, "10.00", "pay-1b", req_key="pay-1:req",
                  approval_id=req.id)["status"] == "instruction_recorded"
    with pytest.raises(ApprovalError):                            # cannot be reused for another payment
        _pay(services, bill, "1.00", "pay-2", approval_id=req.id)


def test_approval_cannot_be_used_for_a_different_payload(services, runner_factory):
    bill = _payable(services, runner_factory)
    with pytest.raises(ApprovalRequired) as exc:
        _pay(services, bill, "10.00", "small")
    services.approvals.approve(exc.value.request.id, Role.OWNER)
    with pytest.raises(ApprovalError, match="payload differs"):
        _pay(services, bill, bill["amount"], "small", approval_id=exc.value.request.id, req_key="big:req")


def test_rejected_approval_never_executes(services, runner_factory):
    bill = _payable(services, runner_factory)
    with pytest.raises(ApprovalRequired) as exc:
        _pay(services, bill, bill["amount"], "r")
    with pytest.raises(ApprovalError):
        services.approvals.reject(exc.value.request.id, Role.OWNER, "")      # reason required
    services.approvals.reject(exc.value.request.id, Role.OWNER, "wrong vendor")
    with pytest.raises(ApprovalError):
        _pay(services, bill, bill["amount"], "r", approval_id=exc.value.request.id)


@pytest.mark.parametrize("role,tool,payload", [
    (Role.ACCOUNTING_MANAGER, "vat.submit_return", {"period": "2026-Q3", "net_payable": "0"}),
    (Role.ACCOUNTING_MANAGER, "payroll.pay", {"period": "2026-09", "total_net": "1"}),
    (Role.ACCOUNTING_MANAGER, "bank.update_account", {"account": "1101", "iban": "SA00"}),
    (Role.ACCOUNTS_PAYABLE, "vendors.add", {"name": "New Vendor"}),
    (Role.ACCOUNTS_PAYABLE, "purchasing.raise_order", {"vendor": "New Vendor", "amount": "5000"}),
    (Role.ACCOUNTING_MANAGER, "ledger.reverse_entry", {"fingerprint": "x", "reason": "r", "on": "2026-01-01"}),
    (Role.ACCOUNTING_MANAGER, "daftra.write_journal", {"entry": {"reference": "R"}}),
])
def test_every_sensitive_operation_is_gated(services, role, tool, payload):
    assert services.gateway.tool(tool).op in APPROVAL_REQUIRED
    with pytest.raises(ApprovalRequired):
        services.gateway.call(role, tool, payload, idempotency_key=f"g-{tool}")


def test_daftra_write_stays_disabled_even_after_approval(services):
    with pytest.raises(ApprovalRequired) as exc:
        services.gateway.call(Role.ACCOUNTING_MANAGER, "daftra.write_journal", {"entry": {}}, idempotency_key="dw")
    services.approvals.approve(exc.value.request.id, Role.OWNER)
    with pytest.raises(WritesDisabled):
        services.gateway.call(Role.ACCOUNTING_MANAGER, "daftra.write_journal", {"entry": {}},
                              idempotency_key="dw", approval_id=exc.value.request.id)


def test_held_entry_posts_only_after_owner_approval(services, runner_factory):
    inv, _ = make_purchase(8, random.Random(8), services.documents)
    runner, _ = runner_factory({"ExpenseDecision": [expense_llm("5101", confidence="low")]})
    r = runner.process_purchase_invoice("h", inv)
    assert r["status"] == "held_for_owner" and not services.ledger.entries
    with pytest.raises(PermissionDenied):
        services.approvals.approve(r["done"]["finalize"]["approval_id"], Role.ACCOUNTING_MANAGER)
    services.approvals.approve(r["done"]["finalize"]["approval_id"], Role.OWNER)
    assert runner.resume_after_review("h", r["done"]["finalize"]["approval_id"])["status"] == "posted"
    assert len(services.ledger.entries) == 1


def test_audit_chain_detects_tampering(services, runner_factory):
    inv, acct = make_purchase(9, random.Random(9), services.documents)
    runner, _ = runner_factory({"ExpenseDecision": [expense_llm(acct)]})
    runner.process_purchase_invoice("t", inv)
    assert services.audit.verify().ok
    with services.store.engine.begin() as cx:
        cx.execute(text("UPDATE audit_log SET outcome='tampered' WHERE seq=3"))
    status = services.audit.verify()
    assert not status.ok and status.first_bad_seq == 3


def test_source_documents_cannot_be_modified(services):
    doc = services.documents.add(b"original bytes", "o.pdf", "receipt")
    services.documents.add(b"original bytes", "renamed.pdf", "receipt")            # same bytes → same doc, no overwrite
    assert services.documents.meta(doc.doc_id).filename == "o.pdf"
    tampered = services.kv.get("document", doc.doc_id)
    tampered["content_b64"] = "dGFtcGVyZWQ="
    services.kv.put("document", doc.doc_id, tampered)                                # simulate DB tampering
    from app.core.documents import DocumentIntegrityError
    with pytest.raises(DocumentIntegrityError):
        services.documents.get(doc.doc_id)
