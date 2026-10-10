"""Payroll calculation with GOSI contributions (deterministic).

GOSI rates change (the 2024 Social Insurance Law phases in higher annuity rates
for new entrants), so every rate below is configuration, not truth. Confirm
the rates for each employee's registration date on gosi.gov.sa before a real run.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from .ledger import JournalEntry, JournalLine
from .money import ZERO, money_sum, mul, to_money


@dataclass(frozen=True)
class GosiRates:
    saudi_employee: Decimal = Decimal("0.0975")     # annuities 9% + SANED 0.75%
    saudi_employer: Decimal = Decimal("0.1175")     # annuities 9% + SANED 0.75% + hazards 2%
    non_saudi_employee: Decimal = Decimal("0")
    non_saudi_employer: Decimal = Decimal("0.02")   # occupational hazards
    wage_cap: Decimal = Decimal("45000.00")         # contributory wage ceiling (basic + housing)


@dataclass(frozen=True)
class Employee:
    employee_id: str
    name: str
    is_saudi: bool
    basic: Decimal
    housing: Decimal = ZERO
    other_allowances: Decimal = ZERO


@dataclass(frozen=True)
class PayslipLine:
    employee_id: str
    gross: Decimal
    gosi_base: Decimal
    gosi_employee: Decimal
    gosi_employer: Decimal
    net_pay: Decimal


@dataclass(frozen=True)
class PayrollRun:
    period: str
    lines: tuple[PayslipLine, ...]

    @property
    def total_gross(self) -> Decimal: return money_sum(l.gross for l in self.lines)
    @property
    def total_net(self) -> Decimal: return money_sum(l.net_pay for l in self.lines)
    @property
    def total_gosi_employee(self) -> Decimal: return money_sum(l.gosi_employee for l in self.lines)
    @property
    def total_gosi_employer(self) -> Decimal: return money_sum(l.gosi_employer for l in self.lines)


def compute_payroll(period: str, employees: list[Employee], rates: GosiRates = GosiRates()) -> PayrollRun:
    lines = []
    for e in employees:
        basic, housing, other = to_money(e.basic), to_money(e.housing), to_money(e.other_allowances)
        gross = basic + housing + other
        base = min(basic + housing, to_money(rates.wage_cap))
        emp_rate = rates.saudi_employee if e.is_saudi else rates.non_saudi_employee
        er_rate = rates.saudi_employer if e.is_saudi else rates.non_saudi_employer
        g_emp, g_er = mul(base, emp_rate), mul(base, er_rate)
        lines.append(PayslipLine(e.employee_id, gross, base, g_emp, g_er, gross - g_emp))
    return PayrollRun(period, tuple(lines))


def payroll_entry(run: PayrollRun, entry_date: date, document_ids: tuple[str, ...], prepared_by: str) -> JournalEntry:
    lines = [
        JournalLine("5301", debit=run.total_gross, memo="gross salaries"),
        JournalLine("2401", credit=run.total_net, memo="net pay due"),
    ]
    if run.total_gosi_employer > 0:
        lines.append(JournalLine("5302", debit=run.total_gosi_employer, memo="GOSI employer share"))
    gosi_total = run.total_gosi_employee + run.total_gosi_employer
    if gosi_total > 0:
        lines.append(JournalLine("2402", credit=gosi_total, memo="GOSI payable"))
    return JournalEntry(entry_date, f"Payroll {run.period}", tuple(lines), document_ids,
                        prepared_by, reference=f"PAYROLL-{run.period}")
