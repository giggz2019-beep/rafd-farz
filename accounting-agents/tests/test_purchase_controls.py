"""Segregation of duties and purchase controls: approved vendors, purchase orders, receipts,
the three-way match, and the 1,000 SAR approval threshold."""
from datetime import date
from decimal import Decimal

import pytest

from app.agents.base import ToolNotAllowed
from app.agents.roster import (AccountingManagerAgent, AccountsPayableAgent, BankReconciliationAgent,
                               InternalAuditAgent)
from app.core.invoices import Direction, Invoice, InvoiceLine
from app.core.serde import invoice_to_dict
from app.core.vat import VatCategory
from app.orchestration.gateway import ApprovalRequired
from app.security.permissions import INCOMPATIBLE, PERMISSIONS, Op, PermissionDenied, Role

from .conftest import approve, approve_vendor, expense_llm


def purchase(services, vendor, amount, number, *, trn=None, po=None):
    doc = services.documents.add(f"{vendor}-{number}-{amount}".encode(), f"{number}.pdf", "purchase_invoice")
    return invoice_to_dict(Invoice(Direction.PURCHASE, number, date(2026, 3, 1), vendor,
                                   (InvoiceLine("service", Decimal(1), Decimal(amount), VatCategory.STANDARD, "0"),),
                                   seller_vat_number=trn, document_id=doc.doc_id, purchase_order_id=po))


def run(runner_factory, services, inv, job):
    runner, _ = runner_factory({"ExpenseDecision": [expense_llm("5101")]}, approve_vendors=False)
    return runner.process_purchase_invoice(job, inv)


def blockers(result):
    return {b["code"] for b in result["done"]["audit"]["blockers"]}


def raise_po(services, vendor, amount, key="po"):
    ap = AccountsPayableAgent(services)
    return approve(services, lambda aid: ap.raise_order(vendor, amount, "cameras", key=key, approval_id=aid))["po_id"]


# ------------------------------------------------------------------ segregation of duties
def test_no_role_holds_both_sides_of_an_incompatible_pair():
    for role, ops in PERMISSIONS.items():
        for a, b in INCOMPATIBLE:
            assert not (a in ops and b in ops), f"{role.value} holds {a.value} and {b.value}"


def test_accounts_payable_cannot_pay_and_reconciliation_cannot_change_bank_details(services):
    with pytest.raises(ToolNotAllowed):
        AccountsPayableAgent(services).tool("payables.execute_payment", {}, key="x")
    with pytest.raises(PermissionDenied):                         # even past the agent layer
        services.gateway.call(Role.ACCOUNTS_PAYABLE, "payables.execute_payment", {}, idempotency_key="x")
    with pytest.raises(ToolNotAllowed):
        BankReconciliationAgent(services).tool("bank.update_account", {}, key="y")
    with pytest.raises(PermissionDenied):
        services.gateway.call(Role.BANK_RECONCILIATION, "bank.update_account", {}, idempotency_key="y")


def test_preparers_never_execute():
    assert Op.EXECUTE_PAYMENT not in PERMISSIONS[Role.ACCOUNTS_PAYABLE]
    assert Op.EXECUTE_PAYROLL_PAYMENT not in PERMISSIONS[Role.PAYROLL_ACCOUNTANT]
    assert Op.SUBMIT_TAX_RETURN not in PERMISSIONS[Role.VAT_ACCOUNTANT]
    assert Op.MODIFY_BANK_ACCOUNT not in PERMISSIONS[Role.BANK_RECONCILIATION]


# ------------------------------------------------------------------ approved vendors
def test_invoice_from_an_unapproved_vendor_is_held_and_not_registered(services, runner_factory):
    r = run(runner_factory, services, purchase(services, "Unknown Trading", "200.00", "U-1"), "u")
    assert r["status"] == "held_for_owner" and "VENDOR_NOT_APPROVED" in blockers(r)
    assert not services.ledger.entries and not services.kv.list("payable")


def test_adding_a_vendor_needs_the_owner(services):
    with pytest.raises(ApprovalRequired):
        AccountsPayableAgent(services).add_vendor("New Co", key="v")
    assert not services.kv.list("vendor")
    approve_vendor(services, "New Co")
    assert [v["name"] for v in services.kv.list("vendor")] == ["New Co"]


def test_invoice_vat_number_must_match_the_approved_vendor(services, runner_factory):
    approve_vendor(services, "STC", "300000000000003")
    r = run(runner_factory, services, purchase(services, "STC", "100.00", "S-1", trn="399999999999993"), "vm")
    assert "VENDOR_VAT_MISMATCH" in blockers(r)


# ------------------------------------------------------------------ threshold 1,000 SAR
@pytest.mark.parametrize("amount,needs_po", [("1000.00", False), ("1000.01", True), ("999.99", False)])
def test_threshold_boundary(services, runner_factory, amount, needs_po):
    approve_vendor(services, "Office Supplies")
    r = run(runner_factory, services, purchase(services, "Office Supplies", amount, "T-1"), "t")
    assert ("PO_REQUIRED" in blockers(r)) == needs_po
    assert r["status"] == ("held_for_owner" if needs_po else "posted")


def test_threshold_comes_from_settings():
    from app.config import Settings
    from app.llm.client import ScriptedLLM
    from app.orchestration.services import build_services
    from app.orchestration.workflows import Agents, JobRunner
    services = build_services(Settings(purchase_approval_threshold=Decimal("5000")))
    approve_vendor(services, "Office Supplies")
    agents = Agents.build(services, ScriptedLLM({"ExpenseDecision": [expense_llm("5101")]}))
    agents.audit.llm = None
    inv = purchase(services, "Office Supplies", "4000.00", "S-1")
    assert JobRunner(services, agents).process_purchase_invoice("s", inv)["status"] == "posted"


def test_standing_limit_covers_a_recurring_subscription_and_nothing_above_it(services, runner_factory):
    approve_vendor(services, "Hosting Co", standing_limit="3000")
    assert run(runner_factory, services, purchase(services, "Hosting Co", "2500.00", "H-1"), "h1")["status"] == "posted"
    r = run(runner_factory, services, purchase(services, "Hosting Co", "3500.00", "H-2"), "h2")
    assert r["status"] == "held_for_owner" and "PO_REQUIRED" in blockers(r)


# ------------------------------------------------------------------ PO + receipt + invoice (three-way match)
def test_full_three_way_match_posts(services, runner_factory):
    approve_vendor(services, "Camera Supplier")
    po = raise_po(services, "Camera Supplier", "5000.00")
    AccountsPayableAgent(services).record_receipt(po, "2026-03-01", "10 cameras delivered", key="rcv")
    r = run(runner_factory, services, purchase(services, "Camera Supplier", "4000.00", "C-1", po=po), "c1")
    assert r["status"] == "posted" and not blockers(r)
    assert services.kv.get("purchase_order", po)["invoiced"] == "4000.00"
    # a second invoice that would take the order past its approved amount is held
    r2 = run(runner_factory, services, purchase(services, "Camera Supplier", "1500.00", "C-2", po=po), "c2")
    assert "PO_EXCEEDED" in blockers(r2)


def test_invoice_without_a_recorded_receipt_is_held(services, runner_factory):
    approve_vendor(services, "Camera Supplier")
    po = raise_po(services, "Camera Supplier", "5000.00")
    r = run(runner_factory, services, purchase(services, "Camera Supplier", "4000.00", "C-1", po=po), "nr")
    assert r["status"] == "held_for_owner" and "RECEIPT_MISSING" in blockers(r)


def test_purchase_order_for_another_vendor_does_not_count(services, runner_factory):
    approve_vendor(services, "Camera Supplier")
    approve_vendor(services, "Other Supplier")
    po = raise_po(services, "Other Supplier", "5000.00")
    AccountsPayableAgent(services).record_receipt(po, "2026-03-01", key="rcv")
    r = run(runner_factory, services, purchase(services, "Camera Supplier", "4000.00", "C-1", po=po), "pv")
    assert "PO_VENDOR_MISMATCH" in blockers(r)


def test_unknown_purchase_order_is_held(services, runner_factory):
    approve_vendor(services, "Camera Supplier")
    r = run(runner_factory, services, purchase(services, "Camera Supplier", "4000.00", "C-1", po="PO-FAKE"), "pf")
    assert "PO_NOT_FOUND" in blockers(r)


def test_purchase_order_needs_an_approved_vendor_and_the_owner(services):
    ap = AccountsPayableAgent(services)
    with pytest.raises(ApprovalRequired) as exc:
        ap.raise_order("Nobody Ltd", "2000", "x", key="po")
    services.approvals.approve(exc.value.request.id, Role.OWNER)
    with pytest.raises(ValueError, match="approve the vendor"):
        ap.raise_order("Nobody Ltd", "2000", "x", key="po", approval_id=exc.value.request.id)
    assert not services.kv.list("purchase_order")


# ------------------------------------------------------------------ paying
def test_payment_is_requested_by_ap_and_executed_by_the_manager_after_owner_approval(services, runner_factory):
    approve_vendor(services, "Office Supplies")
    run(runner_factory, services, purchase(services, "Office Supplies", "800.00", "P-1"), "p")
    bill = services.kv.list("payable")[0]
    req = AccountsPayableAgent(services).request_payment(bill["key"], "800.00", key="req")
    mgr = AccountingManagerAgent(services)
    out = approve(services, lambda aid: mgr.execute_payment(req, key="pay", approval_id=aid))
    assert out["status"] == "instruction_recorded"
    assert services.kv.get("payable", bill["key"])["paid"] == "800.00"
    assert services.kv.get("payment_request", req["request_id"])["status"] == "paid"


def test_manager_cannot_change_the_amount_of_a_request(services, runner_factory):
    approve_vendor(services, "Office Supplies")
    run(runner_factory, services, purchase(services, "Office Supplies", "800.00", "P-1"), "p")
    bill = services.kv.list("payable")[0]
    req = AccountsPayableAgent(services).request_payment(bill["key"], "100.00", key="req")
    mgr = AccountingManagerAgent(services)
    with pytest.raises(ValueError, match="differ from the payment request"):
        approve(services, lambda aid: mgr.execute_payment({**req, "amount": "800.00"}, key="pay", approval_id=aid))


def test_held_invoice_from_unapproved_vendor_is_registered_after_owner_accepts_but_cannot_be_paid(
        services, runner_factory):
    r = run(runner_factory, services, purchase(services, "Walk-in Vendor", "300.00", "W-1"), "w")
    assert r["status"] == "held_for_owner"
    services.approvals.approve(r["done"]["finalize"]["approval_id"], Role.OWNER)
    runner, _ = runner_factory(approve_vendors=False)
    assert runner.resume_after_review("w", r["done"]["finalize"]["approval_id"])["status"] == "posted"
    bill = services.kv.list("payable")[0]                         # registered now that it was accepted
    req = AccountsPayableAgent(services).request_payment(bill["key"], "300.00", key="req")
    mgr = AccountingManagerAgent(services)
    with pytest.raises(ValueError, match="approved vendor list"):
        approve(services, lambda aid: mgr.execute_payment(req, key="pay", approval_id=aid))
    # and a copy of the accepted invoice is now caught as a duplicate
    dup = run(runner_factory, services, purchase(services, "Walk-in Vendor", "300.00", "W-1"), "w2")
    assert dup["status"] == "rejected"


def test_audit_still_reviews_sales_invoices_without_purchase_controls(services):
    ia = InternalAuditAgent(services)
    doc = services.documents.add(b"sale", "s.pdf", "sales_invoice")
    inv = invoice_to_dict(Invoice(Direction.SALES, "S-9", date(2026, 3, 1), "Customer",
                                  (InvoiceLine("x", Decimal(1), Decimal("5000"), VatCategory.STANDARD, "0"),),
                                  document_id=doc.doc_id))
    entry = {"entry_date": "2026-03-01", "description": "s", "reference": "S-9", "prepared_by": "revenue_accountant",
             "source_document_ids": [doc.doc_id],
             "lines": [{"account_code": "1201", "debit": "5000.00", "credit": "0.00"},
                       {"account_code": "4101", "debit": "0.00", "credit": "5000.00"}]}
    assert not ia.review(inv, entry, [], key="s", with_opinion=False).blockers
