"""Dict <-> domain conversions for tool payloads and storage (amounts as strings)."""
from __future__ import annotations

from datetime import date

from .invoices import Direction, Invoice, InvoiceLine
from .ledger import JournalEntry, JournalLine
from .money import to_money
from .vat import VatCategory


def invoice_to_dict(inv: Invoice) -> dict:
    return {
        "direction": inv.direction.value, "number": inv.number, "issue_date": inv.issue_date.isoformat(),
        "counterparty_name": inv.counterparty_name, "seller_vat_number": inv.seller_vat_number,
        "buyer_vat_number": inv.buyer_vat_number, "currency": inv.currency, "document_id": inv.document_id,
        "stated_total": None if inv.stated_total is None else str(to_money(inv.stated_total)),
        "due_date": inv.due_date.isoformat() if inv.due_date else None,
        "lines": [{"description": l.description, "quantity": str(l.quantity), "unit_price": str(l.unit_price),
                   "vat_category": l.vat_category.value, "stated_vat": str(l.stated_vat)} for l in inv.lines],
    }


def invoice_from_dict(d: dict) -> Invoice:
    return Invoice(
        direction=Direction(d["direction"]), number=d["number"], issue_date=date.fromisoformat(d["issue_date"]),
        counterparty_name=d["counterparty_name"], seller_vat_number=d.get("seller_vat_number"),
        buyer_vat_number=d.get("buyer_vat_number"), currency=d.get("currency", "SAR"),
        document_id=d.get("document_id"),
        stated_total=None if d.get("stated_total") is None else to_money(d["stated_total"]),
        due_date=date.fromisoformat(d["due_date"]) if d.get("due_date") else None,
        lines=tuple(InvoiceLine(l["description"], l["quantity"], l["unit_price"],
                                VatCategory(l.get("vat_category", "standard")), l.get("stated_vat", "0"))
                    for l in d["lines"]),
    )


def entry_to_dict(e: JournalEntry) -> dict:
    return {"entry_date": e.entry_date.isoformat(), "description": e.description, "reference": e.reference,
            "prepared_by": e.prepared_by, "source_document_ids": list(e.source_document_ids),
            "lines": [{"account_code": l.account_code, "debit": str(l.debit), "credit": str(l.credit),
                       "memo": l.memo} for l in e.lines]}


def entry_from_dict(d: dict) -> JournalEntry:
    return JournalEntry(date.fromisoformat(d["entry_date"]), d["description"],
                        tuple(JournalLine(l["account_code"], l["debit"], l["credit"], l.get("memo", ""))
                              for l in d["lines"]),
                        tuple(d.get("source_document_ids", [])), d.get("prepared_by", ""), d.get("reference", ""))
