from datetime import date
from decimal import Decimal

import pytest

from app.core.ledger import ChartOfAccounts, JournalEntry, JournalLine, Ledger, UnbalancedEntryError, validate_entry
from app.core.money import MoneyError, money_sum, to_money
from app.core.payroll import Employee, GosiRates, compute_payroll, payroll_entry
from app.core.reconciliation import CashMovement, reconcile
from app.core.vat import VatCategory, is_valid_trn, registration_status, vat_for


class TestMoney:
    def test_rejects_float(self):
        with pytest.raises(MoneyError):
            to_money(0.1)

    def test_rounds_half_up_to_halala(self):
        assert to_money("10.005") == Decimal("10.01")
        assert to_money("1,234.5") == Decimal("1234.50")

    def test_sum_is_exact(self):
        assert money_sum(["0.10"] * 10) == Decimal("1.00")


class TestVat:
    def test_standard_rate(self):
        assert vat_for("100.00", VatCategory.STANDARD) == Decimal("15.00")
        assert vat_for("33.33", VatCategory.STANDARD) == Decimal("5.00")
        assert vat_for("100.00", VatCategory.ZERO_RATED) == Decimal("0.00")

    @pytest.mark.parametrize("trn,ok", [("300000000000003", True), ("310123456700003", True),
                                        ("300000000000004", False), ("30000000000003", False),
                                        ("200000000000003", False), (None, False), ("", False)])
    def test_trn_format(self, trn, ok):
        assert is_valid_trn(trn) is ok

    def test_registration_thresholds(self):
        s = registration_status(["20000.00"] * 12)        # 240,000
        assert s.may_register and not s.must_register
        assert s.headroom_to_mandatory == Decimal("135000.00")
        assert registration_status(["31250.01"] * 12).must_register


class TestLedger:
    coa = ChartOfAccounts()

    def entry(self, *lines, docs=("doc1",)):
        return JournalEntry(date(2026, 1, 1), "test", tuple(lines), docs, "t")

    def test_unbalanced_rejected(self):
        e = self.entry(JournalLine("5101", debit="100"), JournalLine("2101", credit="99.99"))
        assert "UNBALANCED" in {i.code for i in validate_entry(e, self.coa)}
        with pytest.raises(UnbalancedEntryError):
            Ledger().post(e)

    def test_line_must_be_one_sided(self):
        e = self.entry(JournalLine("5101", debit="100", credit="100"), JournalLine("2101", credit="0"))
        codes = {i.code for i in validate_entry(e, self.coa)}
        assert "ONE_SIDE_PER_LINE" in codes

    def test_unknown_account_and_missing_document(self):
        e = self.entry(JournalLine("9999", debit="1"), JournalLine("2101", credit="1"), docs=())
        codes = {i.code for i in validate_entry(e, self.coa)}
        assert {"UNKNOWN_ACCOUNT", "MISSING_DOCUMENT"} <= codes

    def test_posting_is_idempotent(self):
        led = Ledger()
        e = self.entry(JournalLine("5101", debit="100"), JournalLine("2101", credit="100"))
        assert led.post(e) == led.post(e)
        assert len(led.entries) == 1
        assert led.trial_balance() == (Decimal("100.00"), Decimal("100.00"))


class TestPayroll:
    def test_gosi_and_entry_balance(self):
        run = compute_payroll("2026-09", [
            Employee("e1", "Saudi engineer", True, Decimal("10000"), Decimal("2500"), Decimal("500")),
            Employee("e2", "Expat engineer", False, Decimal("8000"), Decimal("2000")),
        ], GosiRates())
        l1, l2 = run.lines
        assert l1.gosi_base == Decimal("12500.00")
        assert l1.gosi_employee == Decimal("1218.75") and l1.gosi_employer == Decimal("1468.75")
        assert l2.gosi_employee == Decimal("0.00") and l2.gosi_employer == Decimal("200.00")
        assert l1.net_pay == Decimal("13000.00") - Decimal("1218.75")
        e = payroll_entry(run, date(2026, 9, 30), ("payroll-doc",), "payroll")
        assert e.total_debit == e.total_credit
        assert not validate_entry(e, ChartOfAccounts())

    def test_wage_cap(self):
        run = compute_payroll("x", [Employee("e", "n", True, Decimal("60000"))], GosiRates())
        assert run.lines[0].gosi_base == Decimal("45000.00")


class TestReconciliation:
    def test_matches_within_window_and_reports_rest(self):
        bank = [CashMovement("b1", date(2026, 1, 2), "-100"), CashMovement("b2", date(2026, 1, 5), "500"),
                CashMovement("b3", date(2026, 1, 9), "-7.50")]
        book = [CashMovement("k1", date(2026, 1, 1), "-100"), CashMovement("k2", date(2026, 1, 20), "500")]
        r = reconcile(bank, book)
        assert r.matched == (("b1", "k1"),)
        assert [m.ref for m in r.unmatched_bank] == ["b2", "b3"]
        assert [m.ref for m in r.unmatched_book] == ["k2"]
        assert not r.is_reconciled
