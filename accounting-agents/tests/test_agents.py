"""Independent tests per agent: each agent's contract in isolation."""
import random
from datetime import date
from decimal import Decimal

import pytest

from app.agents.roster import (AccountingManagerAgent, AccountsPayableAgent, AccountsReceivableAgent, AuditOpinion,
                               AuditReport, BankReconciliationAgent, ExpenseAccountantAgent, FinancialAnalystAgent,
                               Finding, InternalAuditAgent, PayrollAccountantAgent, RevenueAccountantAgent,
                               VatAccountantAgent)
from app.core.invoices import Direction, Invoice, InvoiceLine
from app.core.ledger import JournalEntry, JournalLine
from app.core.serde import entry_from_dict, invoice_to_dict
from app.core.vat import VatCategory
from app.agents.base import ToolNotAllowed
from app.llm.client import LLMError, ScriptedLLM
from app.orchestration.gateway import ApprovalRequired
from app.security.permissions import Role

from .conftest import approve_test_vendors, expense_llm, make_purchase


def sales_invoice(services, amount="1000.00", number="S-1", due=None):
    doc = services.documents.add(f"sales {number}".encode(), "s.pdf", "sales_invoice")
    return invoice_to_dict(Invoice(Direction.SALES, number, date(2026, 5, 1), "Al Khalifi Est.",
                                   (InvoiceLine("monitoring", Decimal(1), Decimal(amount), VatCategory.STANDARD, "0"),),
                                   document_id=doc.doc_id, due_date=due))


class TestAccountingManager:
    def f(self, code, sev="blocker"):
        return Finding(code=code, message=code, severity=sev, source="t")

    @pytest.mark.parametrize("blockers,warnings,opinion,review,conf,expected", [
        ([], [], None, False, "high", "post"),
        (["DUPLICATE"], [], None, False, "high", "reject"),
        (["UNBALANCED"], [], None, False, "high", "hold_for_owner"),
        ([], ["POSSIBLE_DUPLICATE"], None, False, "high", "hold_for_owner"),
        ([], [], "hold", False, "high", "hold_for_owner"),
        ([], [], "approve", True, "high", "hold_for_owner"),
        ([], [], "approve", False, "low", "hold_for_owner"),
    ])
    def test_posting_policy(self, services, blockers, warnings, opinion, review, conf, expected):
        rep = AuditReport(blockers=[self.f(b) for b in blockers], warnings=[self.f(w, "warning") for w in warnings],
                          opinion=AuditOpinion(recommendation=opinion, concerns=[]) if opinion else None)
        d = AccountingManagerAgent(services).decide_posting(rep, preparer_role=Role.EXPENSE_ACCOUNTANT,
                                                            classifier_needs_review=review, classifier_confidence=conf)
        assert d.action == expected


class TestRevenueAccountant:
    def test_deferred_goes_to_customer_advances(self, services):
        llm = ScriptedLLM({"RevenueDecision": {"revenue_account": "4102", "recognition": "deferred",
                                               "rationale": "advance", "needs_human_review": False}})
        d, entry = RevenueAccountantAgent(services, llm).propose(sales_invoice(services), {}, key="r1")
        e = entry_from_dict(entry)
        assert {l.account_code for l in e.lines} == {"1201", "2301"} and e.total_debit == e.total_credit
        assert "Al Khalifi" in llm.calls[0]["user"]          # the model saw the invoice, not a summary

    def test_rejects_a_non_revenue_account(self, services):
        llm = ScriptedLLM({"RevenueDecision": {"revenue_account": "5101", "recognition": "immediate",
                                               "rationale": "x", "needs_human_review": False}})
        with pytest.raises(LLMError):
            RevenueAccountantAgent(services, llm).propose(sales_invoice(services), {}, key="r2")


class TestExpenseAccountant:
    def test_classifies_with_the_chart_and_builds_a_balanced_entry(self, services):
        inv, acct = make_purchase(0, random.Random(0), services.documents)
        llm = ScriptedLLM({"ExpenseDecision": expense_llm(acct)})
        d, entry = ExpenseAccountantAgent(services, llm).propose(inv, key="e1")
        assert d.account_code == acct and "chart_of_accounts" in llm.calls[0]["user"]
        e = entry_from_dict(entry)
        assert e.total_debit == e.total_credit and e.lines[0].account_code == acct

    def test_no_llm_means_no_guessing(self, services):
        inv, _ = make_purchase(1, random.Random(1), services.documents)
        with pytest.raises(LLMError):
            ExpenseAccountantAgent(services, None).propose(inv, key="e2")


class TestAccountsReceivable:
    def test_aging_buckets(self, services):
        ar = AccountsReceivableAgent(services, ScriptedLLM({"CollectionNote": {"message_ar": "تذكير", "tone": "firm"}}))
        ar.register(sales_invoice(services, "1000.00", "S-1", date(2026, 5, 1)), key="a1")
        ar.register(sales_invoice(services, "500.00", "S-2", date(2026, 7, 1)), key="a2")
        aging = ar.aging("2026-07-15", key="ag")
        assert aging["61_90"] == "1000.00" and aging["1_30"] == "500.00"
        assert ar.draft_reminder("Al Khalifi Est.", "1000.00", 75, key="n").tone == "firm"


class TestAccountsPayable:
    def test_register_then_payment_is_gated(self, services):
        inv, _ = make_purchase(2, random.Random(2), services.documents)
        ap = AccountsPayableAgent(services)
        key = ap.register(inv, key="p1")["key"]
        req = ap.request_payment(key, "1.00", key="req")
        assert req["status"] == "open"                       # a request, not a payment
        with pytest.raises(ToolNotAllowed):
            ap.tool("payables.execute_payment", {}, key="self-pay")
        with pytest.raises(ApprovalRequired):
            AccountingManagerAgent(services).execute_payment(req, key="pay")


class TestPayrollAccountant:
    def test_prepare_and_gate(self, services):
        pa = PayrollAccountantAgent(services)
        out = pa.prepare("2026-09", [{"employee_id": "e1", "name": "A", "is_saudi": True, "basic": "8000",
                                      "housing": "2000"}], "2026-09-30", ["contract-1"], key="pr")
        assert out["total_gross"] == "10000.00" and out["gosi_employee"] == "975.00"
        e = entry_from_dict(out["entry"])
        assert e.total_debit == e.total_credit
        with pytest.raises(ToolNotAllowed):
            pa.tool("payroll.pay", {}, key="self-pay")
        with pytest.raises(ApprovalRequired):
            AccountingManagerAgent(services).pay_payroll("2026-09", out["total_net"], key="pay")


class TestVatAccountant:
    def test_validate_prepare_and_gate_filing(self, services):
        vat = VatAccountantAgent(services)
        bad = sales_invoice(services)
        bad["lines"][0]["stated_vat"] = "150.00"
        assert vat.validate(bad, key="v")[0]["code"] == "VAT_CHARGED_BY_UNREGISTERED"
        AccountsReceivableAgent(services).register(sales_invoice(services, "200.00", "S-7"), key="r")
        summary = vat.prepare_return("2026-Q2", key="ret")
        assert summary["standard_rated_sales"] == "200.00" and summary["output_vat"] == "0.00"
        with pytest.raises(ToolNotAllowed):                  # the preparer does not file
            vat.tool("vat.submit_return", summary, key="self-file")
        with pytest.raises(ApprovalRequired):
            AccountingManagerAgent(services).submit_vat_return(summary, key="file")


class TestBankReconciliation:
    def test_reconcile_and_explain(self, services):
        llm = ScriptedLLM({"ReconNote": {"likely_causes": ["bank fee not booked"], "next_steps": ["book fee"]}})
        br = BankReconciliationAgent(services, llm)
        r = br.reconcile([{"ref": "b1", "on": "2026-01-02", "amount": "-100"},
                          {"ref": "b2", "on": "2026-01-03", "amount": "-0.58"}],
                         [{"ref": "k1", "on": "2026-01-02", "amount": "-100"}], key="rc")
        assert r["matched"] == [["b1", "k1"]] and r["unmatched_bank"] == ["b2"] and r["difference"] == "-0.58"
        assert br.explain(r, key="ex").likely_causes


class TestFinancialAnalyst:
    def _ledger(self, services):
        services.ledger.post(JournalEntry(date(2026, 1, 1), "sale", (JournalLine("1201", debit="1456.49"),
                                                                       JournalLine("4102", credit="1456.49")),
                                          ("d",), "t"))

    def test_report_balances(self, services):
        self._ledger(services)
        r = FinancialAnalystAgent(services).report(key="rep")
        assert r["revenue"] == "1456.49" and r["balance_sheet_balances"] is True

    def test_commentary_with_invented_numbers_is_withheld(self, services):
        self._ledger(services)
        llm = ScriptedLLM({"AnalystCommentary": [
            {"headline": "Revenue 1456.49", "observations": ["first sale"], "risks": []},
            {"headline": "Revenue grew to 250,000", "observations": [], "risks": []}]})
        fa = FinancialAnalystAgent(services, llm)
        figures = fa.report(key="rep")
        assert fa.commentary(figures, key="c1")[0] is not None
        note, bad = fa.commentary(figures, key="c2")
        assert note is None and "250,000" in bad


class TestInternalAudit:
    def test_findings_are_deterministic_and_opinion_optional(self, services):
        approve_test_vendors(services)
        inv, acct = make_purchase(3, random.Random(3), services.documents)
        _, entry = ExpenseAccountantAgent(services, ScriptedLLM({"ExpenseDecision": expense_llm(acct)})) \
            .propose(inv, key="x")
        ia = InternalAuditAgent(services)
        clean = ia.review(inv, entry, [], key="a1")
        assert not clean.blockers and clean.opinion is None
        broken = dict(entry, lines=entry["lines"][:1])
        report = ia.review({**inv, "document_id": None}, broken, [], key="a2")
        assert {"MISSING_DOCUMENT", "UNBALANCED", "TOO_FEW_LINES"} <= {b.code for b in report.blockers}
