"""Financial statements computed from the ledger (deterministic)."""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from .ledger import AccountType, Ledger
from .money import ZERO


@dataclass(frozen=True)
class IncomeStatement:
    revenue: Decimal
    expenses: Decimal

    @property
    def net_income(self) -> Decimal:
        return self.revenue - self.expenses


@dataclass(frozen=True)
class BalanceSheet:
    assets: Decimal
    liabilities: Decimal
    equity: Decimal               # including current-period result

    @property
    def balances(self) -> bool:
        return self.assets == self.liabilities + self.equity


def income_statement(ledger: Ledger) -> IncomeStatement:
    rev = exp = ZERO
    for code, bal in ledger.balances().items():
        t = ledger.coa.get(code).type
        if t == AccountType.REVENUE:
            rev += -bal
        elif t == AccountType.EXPENSE:
            exp += bal
    return IncomeStatement(rev, exp)


def balance_sheet(ledger: Ledger) -> BalanceSheet:
    a = l = e = ZERO
    for code, bal in ledger.balances().items():
        t = ledger.coa.get(code).type
        if t == AccountType.ASSET:
            a += bal
        elif t == AccountType.LIABILITY:
            l += -bal
        elif t == AccountType.EQUITY:
            e += -bal
    return BalanceSheet(a, l, e + income_statement(ledger).net_income)
