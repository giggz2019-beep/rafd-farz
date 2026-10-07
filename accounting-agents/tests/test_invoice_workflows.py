"""100 sample invoices, duplicates, VAT errors, missing documents."""
import random
from datetime import date
from decimal import Decimal

from app.core.invoices import Direction, Invoice, InvoiceLine
from app.core.money import money_sum
from app.core.serde import invoice_from_dict, invoice_to_dict
from app.core.vat import VatCategory

from .conftest import expense_llm, make_purchase


def test_100_sample_invoices_post_and_balance(services, runner_factory):
    rng = random.Random(2026)
    invoices = [make_purchase(i, rng, services.documents) for i in range(100)]
    runner, llm = runner_factory({"ExpenseDecision": [expense_llm(acct) for _, acct in invoices]})
    statuses = [runner.process_purchase_invoice(f"job-{i}", inv)["status"] for i, (inv, _) in enumerate(invoices)]
    assert statuses == ["posted"] * 100
    assert len(services.ledger.entries) == 100
    dr, cr = services.ledger.trial_balance()
    expected = money_sum(invoice_from_dict(inv).total for inv, _ in invoices)
    assert dr == cr == expected                       # every riyal accounted for, deterministically
    assert services.audit.verify().ok
    assert len(llm.calls) == 100                       # one classification per invoice, no more


def test_exact_duplicate_is_rejected(services, runner_factory):
    inv, acct = make_purchase(1, random.Random(1), services.documents)
    runner, _ = runner_factory({"ExpenseDecision": [expense_llm(acct)] * 2})
    assert runner.process_purchase_invoice("a", inv)["status"] == "posted"
    second = runner.process_purchase_invoice("b", inv)
    assert second["status"] == "rejected"
    assert len(services.ledger.entries) == 1


def test_duplicate_number_with_different_formatting_is_caught(services, runner_factory):
    inv, acct = make_purchase(2, random.Random(3), services.documents)
    runner, _ = runner_factory({"ExpenseDecision": [expense_llm(acct)] * 2})
    runner.process_purchase_invoice("a", inv)
    other_doc = services.documents.add(b"a rescanned copy", "scan.pdf", "purchase_invoice")
    variant = {**inv, "number": " inv-" + inv["number"][4:] + " ", "document_id": other_doc.doc_id}
    assert runner.process_purchase_invoice("b", variant)["status"] == "rejected"


def test_possible_duplicate_is_held_for_owner(services, runner_factory):
    inv, acct = make_purchase(3, random.Random(4), services.documents)
    runner, _ = runner_factory({"ExpenseDecision": [expense_llm(acct)] * 2})
    runner.process_purchase_invoice("a", inv)
    doc = services.documents.add(b"different paper", "x.pdf", "purchase_invoice")
    near = {**inv, "number": "COMPLETELY-OTHER-9", "document_id": doc.doc_id}
    r = runner.process_purchase_invoice("b", near)
    assert r["status"] == "held_for_owner"
    assert any("looks like" in x for x in r["done"]["finalize"]["decision"]["reasons"])


def _registered_vendor_invoice(services, vat: str, trn="300000000000003", number="V-1"):
    doc = services.documents.add(number.encode() + vat.encode(), "v.pdf", "purchase_invoice")
    return invoice_to_dict(Invoice(Direction.PURCHASE, number, date(2026, 3, 1), "STC",
                                   (InvoiceLine("internet", Decimal(1), Decimal("200.00"), VatCategory.STANDARD, vat),),
                                   seller_vat_number=trn, document_id=doc.doc_id))


def test_incorrect_vat_is_blocked(services, runner_factory):
    runner, _ = runner_factory({"ExpenseDecision": [expense_llm("5801")]})
    r = runner.process_purchase_invoice("v", _registered_vendor_invoice(services, "20.00"))
    assert r["status"] == "held_for_owner"
    assert "VAT_MISCALCULATED" in {b["code"] for b in r["done"]["audit"]["blockers"]}
    assert not services.ledger.entries


def test_one_halala_rounding_difference_does_not_block(services, runner_factory):
    runner, _ = runner_factory({"ExpenseDecision": [expense_llm("5801")]})
    inv = _registered_vendor_invoice(services, "30.01", number="V-R")
    r = runner.process_purchase_invoice("vr", inv)
    assert r["status"] == "posted"
    assert r["done"]["vat"]["issues"][0]["code"] == "VAT_ROUNDING"


def test_correct_vat_posts_and_vat_is_part_of_cost_when_unregistered(services, runner_factory):
    runner, _ = runner_factory({"ExpenseDecision": [expense_llm("5801")]})
    r = runner.process_purchase_invoice("v", _registered_vendor_invoice(services, "30.00"))
    assert r["status"] == "posted"
    assert services.ledger.balances()["5801"] == Decimal("230.00")      # no input-VAT recovery
    assert "1301" not in services.ledger.balances()


def test_unregistered_seller_charging_vat_is_blocked(services, runner_factory):
    runner, _ = runner_factory({"ExpenseDecision": [expense_llm("5801")]})
    r = runner.process_purchase_invoice("v", _registered_vendor_invoice(services, "30.00", trn=None))
    assert "VAT_CHARGED_BY_UNREGISTERED" in {b["code"] for b in r["done"]["audit"]["blockers"]}


def test_unregistered_company_cannot_charge_vat_on_sales(services, runner_factory):
    doc = services.documents.add(b"sales-1", "s.pdf", "sales_invoice")
    inv = invoice_to_dict(Invoice(Direction.SALES, "S-1", date(2026, 3, 1), "Customer Co",
                                  (InvoiceLine("monitoring", Decimal(1), Decimal("1000"), VatCategory.STANDARD, "150"),),
                                  document_id=doc.doc_id))
    runner, _ = runner_factory({"RevenueDecision": [{"revenue_account": "4102", "recognition": "immediate",
                                                      "rationale": "t", "needs_human_review": False}]})
    r = runner.process_sales_invoice("s", inv, {"service_delivered": True})
    assert r["status"] == "held_for_owner"
    assert "VAT_CHARGED_BY_UNREGISTERED" in {b["code"] for b in r["done"]["audit"]["blockers"]}


def test_missing_document_is_blocked(services, runner_factory):
    inv, acct = make_purchase(5, random.Random(5), services.documents)
    inv = {**inv, "document_id": None}
    runner, _ = runner_factory({"ExpenseDecision": [expense_llm(acct)]})
    r = runner.process_purchase_invoice("m", inv)
    assert r["status"] == "held_for_owner"
    assert "MISSING_DOCUMENT" in {b["code"] for b in r["done"]["audit"]["blockers"]}
    assert not services.ledger.entries


def test_unknown_document_id_is_blocked(services, runner_factory):
    inv, acct = make_purchase(6, random.Random(6), services.documents)
    inv = {**inv, "document_id": "f" * 64}
    runner, _ = runner_factory({"ExpenseDecision": [expense_llm(acct)]})
    assert runner.process_purchase_invoice("m", inv)["status"] == "held_for_owner"


def test_customer_advance_is_deferred_not_revenue(services, runner_factory):
    doc = services.documents.add(b"advance", "a.pdf", "sales_invoice")
    inv = invoice_to_dict(Invoice(Direction.SALES, "S-9", date(2026, 10, 6), "Customer Co",
                                  (InvoiceLine("annual monitoring, paid in advance", Decimal(1), Decimal("70000"),
                                               VatCategory.STANDARD, "0"),), document_id=doc.doc_id))
    runner, _ = runner_factory({"RevenueDecision": [{"revenue_account": "4102", "recognition": "deferred",
                                                      "rationale": "paid before service", "needs_human_review": False}]})
    assert runner.process_sales_invoice("adv", inv, {"service_delivered": False})["status"] == "posted"
    bal = services.ledger.balances()
    assert bal["2301"] == Decimal("-70000.00") and "4102" not in bal
