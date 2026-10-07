"""Invoice model, deterministic totals, validation and duplicate detection."""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from enum import Enum

from ..storage.kv import KV, MemoryKV
from .money import ZERO, money_sum, to_money
from .vat import VatCategory, VatIssue, check_lines, is_valid_trn


class Direction(str, Enum):
    SALES = "sales"
    PURCHASE = "purchase"


@dataclass(frozen=True)
class InvoiceLine:
    description: str
    quantity: Decimal
    unit_price: Decimal
    vat_category: VatCategory = VatCategory.STANDARD
    stated_vat: Decimal = ZERO

    def __post_init__(self):
        object.__setattr__(self, "quantity", Decimal(str(self.quantity)))
        object.__setattr__(self, "unit_price", to_money(self.unit_price))
        object.__setattr__(self, "stated_vat", to_money(self.stated_vat))

    @property
    def net(self) -> Decimal:
        return to_money(self.quantity * self.unit_price)


@dataclass(frozen=True)
class Invoice:
    direction: Direction
    number: str
    issue_date: date
    counterparty_name: str
    lines: tuple[InvoiceLine, ...]
    seller_vat_number: str | None = None
    buyer_vat_number: str | None = None
    stated_total: Decimal | None = None
    currency: str = "SAR"
    document_id: str | None = None      # SourceDocument.doc_id
    due_date: date | None = None

    @property
    def subtotal(self) -> Decimal:
        return money_sum(l.net for l in self.lines)

    @property
    def vat_total(self) -> Decimal:
        return money_sum(l.stated_vat for l in self.lines)

    @property
    def total(self) -> Decimal:
        return self.subtotal + self.vat_total


@dataclass(frozen=True)
class InvoiceIssue:
    code: str
    message: str
    severity: str = "error"


def validate_invoice(inv: Invoice, *, company_vat_registered: bool) -> list[InvoiceIssue]:
    issues: list[InvoiceIssue] = []
    if not inv.document_id:
        issues.append(InvoiceIssue("MISSING_DOCUMENT", "no source document attached"))
    if not inv.number.strip():
        issues.append(InvoiceIssue("NO_NUMBER", "invoice number is missing"))
    if not inv.lines:
        issues.append(InvoiceIssue("NO_LINES", "invoice has no lines"))
    if inv.currency != "SAR":
        issues.append(InvoiceIssue("FOREIGN_CURRENCY",
                                   f"{inv.currency} invoice needs an SAR conversion rate before posting"))
    for i, l in enumerate(inv.lines, 1):
        if l.quantity <= 0 or l.unit_price < 0:
            issues.append(InvoiceIssue("BAD_LINE", f"line {i}: non-positive quantity or negative price"))
    if inv.stated_total is not None and to_money(inv.stated_total) != inv.total:
        issues.append(InvoiceIssue("TOTAL_MISMATCH",
                                   f"stated total {to_money(inv.stated_total)} ≠ computed {inv.total}"))

    # Whose VAT registration decides the VAT? The seller's.
    if inv.direction == Direction.SALES:
        seller_registered = company_vat_registered
    else:
        seller_registered = is_valid_trn(inv.seller_vat_number)
        if inv.seller_vat_number and not seller_registered:
            issues.append(InvoiceIssue("INVALID_TRN", f"seller VAT number {inv.seller_vat_number!r} is malformed"))
    vat_issues: list[VatIssue] = check_lines(inv.lines, seller_vat_registered=seller_registered)
    issues.extend(InvoiceIssue(v.code, v.message, v.severity) for v in vat_issues)
    return issues


def _norm(s: str | None) -> str:
    s = unicodedata.normalize("NFKC", s or "").lower()
    return re.sub(r"[^0-9a-z؀-ۿ]", "", s)


def exact_key(inv: Invoice) -> tuple[str, str, str]:
    party = _norm(inv.seller_vat_number) or _norm(inv.counterparty_name)
    number = re.sub(r"^0+", "", _norm(inv.number))
    return (inv.direction.value, party, number)


def _fuzzy_key(inv: Invoice) -> str:
    return "|".join((inv.direction.value, _norm(inv.counterparty_name), inv.issue_date.isoformat(), str(inv.total)))


class DuplicateDetector:
    """Exact duplicates block; near-duplicates (same party, date and total) are flagged for a human."""

    def __init__(self, kv: KV | None = None):
        self.kv = kv or MemoryKV()

    def check(self, inv: Invoice) -> tuple[str, str | None]:
        """Returns (verdict, existing_key) where verdict ∈ unique|duplicate|possible_duplicate."""
        if inv.document_id and (d := self.kv.get("dup_doc", inv.document_id)):
            return "duplicate", d["key"]
        if d := self.kv.get("dup_exact", "|".join(exact_key(inv))):
            return "duplicate", d["key"]
        if d := self.kv.get("dup_fuzzy", _fuzzy_key(inv)):
            return "possible_duplicate", d["key"]
        return "unique", None

    def register(self, inv: Invoice) -> str:
        key = "|".join(exact_key(inv))
        self.kv.add("dup_exact", key, {"key": key})
        self.kv.add("dup_fuzzy", _fuzzy_key(inv), {"key": key})
        if inv.document_id:
            self.kv.add("dup_doc", inv.document_id, {"key": key})
        return key
