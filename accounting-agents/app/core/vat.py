"""Saudi VAT rules (deterministic).

Sources of the rules encoded here (verify before relying on them in a filing):
- Standard rate 15% (KSA VAT Implementing Regulations, since 1 July 2020).
- Mandatory registration when taxable supplies exceed SAR 375,000 in 12 months;
  voluntary registration available above SAR 187,500.
- A VAT registration number (TRN) is 15 digits beginning and ending with "3".

The company is NOT VAT-registered at the time of writing (see
``Settings.company_vat_registered``). An unregistered business must not charge
VAT on its sales and cannot recover VAT on its purchases, so purchase VAT is
part of the expense.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal
from enum import Enum
from typing import Iterable

from .money import ZERO, mul, money_sum, to_money

STANDARD_RATE = Decimal("0.15")
MANDATORY_THRESHOLD = Decimal("375000.00")
VOLUNTARY_THRESHOLD = Decimal("187500.00")
ROUNDING_TOLERANCE = Decimal("0.01")    # per line: suppliers round half-even or on the total
_TRN_RE = re.compile(r"^3\d{13}3$")


class VatCategory(str, Enum):
    STANDARD = "standard"        # 15%
    ZERO_RATED = "zero_rated"    # 0%, still a taxable supply
    EXEMPT = "exempt"            # outside the VAT chain
    OUT_OF_SCOPE = "out_of_scope"


RATES = {
    VatCategory.STANDARD: STANDARD_RATE,
    VatCategory.ZERO_RATED: Decimal("0"),
    VatCategory.EXEMPT: Decimal("0"),
    VatCategory.OUT_OF_SCOPE: Decimal("0"),
}


def is_valid_trn(trn: str | None) -> bool:
    return bool(trn) and bool(_TRN_RE.match(trn.strip()))


def vat_for(net: object, category: VatCategory) -> Decimal:
    return mul(net, RATES[category])


@dataclass(frozen=True)
class VatIssue:
    code: str
    message: str
    severity: str = "error"   # error blocks posting; warning holds for review; info is only recorded


def check_lines(lines: Iterable["object"], *, seller_vat_registered: bool) -> list[VatIssue]:
    """Recompute VAT per line and compare with what the document states.

    ``lines`` items expose ``net``, ``vat_category`` and ``stated_vat``.
    """
    issues: list[VatIssue] = []
    for i, line in enumerate(lines, 1):
        expected = vat_for(line.net, line.vat_category) if seller_vat_registered else ZERO
        stated = to_money(line.stated_vat)
        if stated != expected:
            if not seller_vat_registered and stated != ZERO:
                issues.append(VatIssue("VAT_CHARGED_BY_UNREGISTERED",
                                       f"line {i}: VAT {stated} charged by a seller with no valid VAT number"))
            elif abs(stated - expected) <= ROUNDING_TOLERANCE:
                issues.append(VatIssue("VAT_ROUNDING",
                                       f"line {i}: stated VAT {stated} vs {expected} — rounding difference",
                                       "info"))
            else:
                issues.append(VatIssue("VAT_MISCALCULATED",
                                       f"line {i}: stated VAT {stated}, expected {expected} "
                                       f"({line.vat_category.value} on {to_money(line.net)})"))
    return issues


@dataclass(frozen=True)
class RegistrationStatus:
    rolling_12m_taxable: Decimal
    must_register: bool
    may_register: bool
    headroom_to_mandatory: Decimal


def registration_status(monthly_taxable_supplies: Iterable[object]) -> RegistrationStatus:
    """``monthly_taxable_supplies``: the last 12 months, oldest first."""
    months = list(monthly_taxable_supplies)[-12:]
    total = money_sum(months)
    return RegistrationStatus(
        rolling_12m_taxable=total,
        must_register=total > MANDATORY_THRESHOLD,
        may_register=total > VOLUNTARY_THRESHOLD,
        headroom_to_mandatory=max(MANDATORY_THRESHOLD - total, ZERO),
    )


@dataclass(frozen=True)
class VatReturnSummary:
    period: str
    output_vat: Decimal
    input_vat: Decimal
    net_payable: Decimal
    standard_rated_sales: Decimal
    zero_rated_sales: Decimal
    exempt_sales: Decimal
    standard_rated_purchases: Decimal


def summarize_return(period: str, sales: Iterable["object"], purchases: Iterable["object"]) -> VatReturnSummary:
    """Aggregate invoices into return boxes. Preparation only; never filed automatically."""
    std_sales = zero_sales = exempt_sales = std_purch = out_vat = in_vat = ZERO
    for inv in sales:
        for ln in inv.lines:
            if ln.vat_category == VatCategory.STANDARD:
                std_sales += to_money(ln.net)
                out_vat += to_money(ln.stated_vat)
            elif ln.vat_category == VatCategory.ZERO_RATED:
                zero_sales += to_money(ln.net)
            elif ln.vat_category == VatCategory.EXEMPT:
                exempt_sales += to_money(ln.net)
    for inv in purchases:
        for ln in inv.lines:
            if ln.vat_category == VatCategory.STANDARD:
                std_purch += to_money(ln.net)
                in_vat += to_money(ln.stated_vat)
    return VatReturnSummary(period, out_vat, in_vat, out_vat - in_vat,
                            std_sales, zero_sales, exempt_sales, std_purch)
