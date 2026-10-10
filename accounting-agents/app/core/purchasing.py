"""Purchase controls: approved vendors, purchase orders, receipts, three-way match.

Pure rules, no I/O. The tools in services.py load the records and call these.

  * Every purchase invoice must come from a vendor the owner approved.
  * A purchase above the approval threshold needs an owner-approved purchase order, with the
    goods or service recorded as received, and the invoice must fit inside that order — unless
    the vendor was approved with a standing limit (a recurring subscription) that covers it.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from .invoices import Invoice, _norm
from .money import to_money


@dataclass(frozen=True)
class ControlIssue:
    code: str
    message: str


def vendor_key(name: str) -> str:
    return _norm(name)


def find_vendor(inv: Invoice, vendors: list[dict]) -> dict | None:
    """Match on VAT number first (hard to fake), then on the normalised name."""
    if inv.seller_vat_number:
        for v in vendors:
            if v.get("vat_number") and _norm(v["vat_number"]) == _norm(inv.seller_vat_number):
                return v
    key = vendor_key(inv.counterparty_name)
    return next((v for v in vendors if v["key"] == key), None)


def needs_purchase_order(total: Decimal, threshold: Decimal, vendor: dict | None) -> bool:
    if total <= threshold:
        return False
    limit = vendor.get("standing_limit") if vendor else None
    return not (limit is not None and total <= to_money(limit))


def check_controls(inv: Invoice, vendors: list[dict], po: dict | None, *, threshold: Decimal) -> list[ControlIssue]:
    issues: list[ControlIssue] = []
    vendor = find_vendor(inv, vendors)
    if vendor is None:
        issues.append(ControlIssue("VENDOR_NOT_APPROVED",
                                   f"vendor '{inv.counterparty_name}' is not on the approved vendor list"))
    elif vendor.get("vat_number") and inv.seller_vat_number \
            and _norm(vendor["vat_number"]) != _norm(inv.seller_vat_number):
        issues.append(ControlIssue("VENDOR_VAT_MISMATCH",
                                   "invoice VAT number differs from the approved vendor's VAT number"))

    total = inv.total
    if inv.purchase_order_id is None:
        if needs_purchase_order(total, threshold, vendor):
            issues.append(ControlIssue("PO_REQUIRED", f"purchase of {total} SAR exceeds {threshold} SAR "
                                                      "and has no approved purchase order"))
        return issues

    if po is None:
        issues.append(ControlIssue("PO_NOT_FOUND", f"purchase order {inv.purchase_order_id} does not exist"))
        return issues
    if vendor is None or po["vendor_key"] != vendor["key"]:
        issues.append(ControlIssue("PO_VENDOR_MISMATCH", "purchase order was raised for a different vendor"))
    remaining = to_money(po["amount"]) - to_money(po["invoiced"])
    if total > remaining:
        issues.append(ControlIssue("PO_EXCEEDED", f"invoice {total} SAR exceeds the {remaining} SAR left "
                                                  f"on purchase order {po['id']}"))
    if not po.get("receipts"):
        issues.append(ControlIssue("RECEIPT_MISSING", f"nothing recorded as received on {po['id']}"))
    return issues
