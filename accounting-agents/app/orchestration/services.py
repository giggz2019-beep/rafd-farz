"""Shared services and the tool catalogue.

Each tool is a small deterministic function bound to one Operation. Agents
reach these only through the ToolGateway. Effectful tools that would touch the
outside world (payments, payroll transfers, tax filing, bank-detail changes,
Daftra writes) do NOT perform the effect in this version: they record an
instruction for a human to carry out, after the owner's approval.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from ..config import Settings
from ..core.documents import DocumentStore
from ..core.invoices import Direction, DuplicateDetector, validate_invoice
from ..core.ledger import AccountType, JournalEntry, JournalLine, Ledger, validate_entry
from ..core.money import to_money
from ..core.payroll import Employee, compute_payroll, payroll_entry
from ..core.reconciliation import CashMovement, reconcile
from ..core.reports import balance_sheet, income_statement
from ..core.serde import entry_from_dict, entry_to_dict, invoice_from_dict
from ..core.vat import summarize_return
from ..daftra.adapter import DaftraAdapter, MockDaftraAdapter, WritesDisabled
from ..security.approvals import ApprovalService
from ..security.audit import AuditLog
from ..security.permissions import Op
from ..core.serde import invoice_to_dict
from ..storage.kv import StoreKV
from ..storage.store import Store
from .gateway import Tool, ToolGateway


@dataclass
class Services:
    settings: Settings
    store: Store
    audit: AuditLog
    approvals: ApprovalService
    gateway: ToolGateway
    kv: StoreKV
    documents: DocumentStore
    ledger: Ledger
    duplicates: DuplicateDetector
    daftra: DaftraAdapter

    def invoices_seen(self, direction: str) -> list:
        return [invoice_from_dict(d) for d in self.kv.list(f"invoice_{direction}")]


def build_services(settings: Settings, *, store: Store | None = None, daftra: DaftraAdapter | None = None) -> Services:
    store = store or Store(settings.database_url)
    audit = AuditLog(store)
    approvals = ApprovalService(store, audit)
    kv = StoreKV(store)
    svc = Services(settings, store, audit, approvals, ToolGateway(store, audit, approvals), kv,
                   DocumentStore(kv), Ledger(kv=kv), DuplicateDetector(kv), daftra or MockDaftraAdapter())
    _register_tools(svc)
    return svc


def _expense_entry(inv, account_code: str, settings: Settings, prepared_by: str) -> JournalEntry:
    """Dr expense (+ input VAT if the company is registered) / Cr accounts payable."""
    vat = inv.vat_total
    if settings.company_vat_registered and vat > 0:
        lines = (JournalLine(account_code, debit=inv.subtotal, memo=inv.counterparty_name),
                 JournalLine("1301", debit=vat, memo="input VAT"),
                 JournalLine("2101", credit=inv.total, memo=f"payable {inv.number}"))
    else:  # unregistered: VAT cannot be recovered, it is part of the cost
        lines = (JournalLine(account_code, debit=inv.total, memo=inv.counterparty_name),
                 JournalLine("2101", credit=inv.total, memo=f"payable {inv.number}"))
    return JournalEntry(inv.issue_date, f"Purchase {inv.number} — {inv.counterparty_name}", lines,
                        (inv.document_id,) if inv.document_id else (), prepared_by, f"PINV-{inv.number}")


def _revenue_entry(inv, revenue_account: str, deferred: bool, settings: Settings, prepared_by: str) -> JournalEntry:
    credit_acct = "2301" if deferred else revenue_account
    lines = [JournalLine("1201", debit=inv.total, memo=inv.counterparty_name),
             JournalLine(credit_acct, credit=inv.subtotal, memo="deferred" if deferred else "revenue")]
    if inv.vat_total > 0:
        lines.append(JournalLine("2201", credit=inv.vat_total, memo="output VAT"))
    return JournalEntry(inv.issue_date, f"Sales {inv.number} — {inv.counterparty_name}", tuple(lines),
                        (inv.document_id,) if inv.document_id else (), prepared_by, f"SINV-{inv.number}")


def _register_tools(s: Services) -> None:
    g, cfg = s.gateway, s.settings
    reg = g.register

    # ---- read ----
    reg(Tool("ledger.balances", Op.READ_LEDGER, lambda p: {k: str(v) for k, v in s.ledger.balances().items()}))

    def verify_document(p):
        doc_id = p.get("document_id")
        if not doc_id or not s.documents.exists(doc_id):
            return {"ok": False, "reason": "missing"}
        s.documents.get(doc_id)            # raises on integrity failure
        return {"ok": True}
    reg(Tool("documents.verify", Op.READ_DOCUMENTS, verify_document))

    reg(Tool("daftra.list_journals", Op.READ_DAFTRA, lambda p: s.daftra.list_journals(p.get("page", 1))))

    # ---- audit ----
    def check_duplicate(p):
        verdict, existing = s.duplicates.check(invoice_from_dict(p["invoice"]))
        return {"verdict": verdict, "existing": existing}
    reg(Tool("invoices.check_duplicate", Op.AUDIT_REVIEW, check_duplicate))

    def review_entry(p):
        entry = entry_from_dict(p["entry"])
        issues = validate_entry(entry, s.ledger.coa)
        return {"issues": [{"code": i.code, "message": i.message} for i in issues]}
    reg(Tool("audit.review_entry", Op.AUDIT_REVIEW, review_entry))
    reg(Tool("audit.verify_chain", Op.VERIFY_AUDIT_LOG, lambda p: s.audit.verify().__dict__))

    # ---- VAT ----
    def validate_inv(p):
        inv = invoice_from_dict(p["invoice"])
        issues = validate_invoice(inv, company_vat_registered=cfg.company_vat_registered)
        return {"issues": [{"code": i.code, "message": i.message, "severity": i.severity} for i in issues]}
    reg(Tool("vat.validate_invoice", Op.VALIDATE_VAT, validate_inv))

    def prepare_return(p):
        r = summarize_return(p["period"], s.invoices_seen("sales"), s.invoices_seen("purchase"))
        return {k: (str(v) if isinstance(v, Decimal) else v) for k, v in r.__dict__.items()}
    reg(Tool("vat.prepare_return", Op.PREPARE_VAT_RETURN, prepare_return))
    reg(Tool("vat.submit_return", Op.SUBMIT_TAX_RETURN,
             lambda p: {"status": "package_ready_for_manual_filing",
                        "note": "No automated ZATCA submission exists in this system; file on the ZATCA portal."},
             summarize=lambda p: f"VAT return {p.get('period')} — net payable {p.get('net_payable')} SAR"))

    # ---- expense / revenue ----
    def propose_expense(p):
        inv = invoice_from_dict(p["invoice"])
        acct = s.ledger.coa.get(p["account_code"])
        if acct is None or acct.type not in (AccountType.EXPENSE, AccountType.ASSET):
            raise ValueError(f"{p['account_code']} is not an expense or asset account")
        return entry_to_dict(_expense_entry(inv, acct.code, cfg, p["prepared_by"]))
    reg(Tool("expense.propose_entry", Op.PROPOSE_EXPENSE_ENTRY, propose_expense))

    def propose_revenue(p):
        inv = invoice_from_dict(p["invoice"])
        if p["revenue_account"] not in s.ledger.coa.codes(AccountType.REVENUE):
            raise ValueError(f"{p['revenue_account']} is not a revenue account")
        return entry_to_dict(_revenue_entry(inv, p["revenue_account"], p["deferred"], cfg, p["prepared_by"]))
    reg(Tool("revenue.propose_entry", Op.PROPOSE_REVENUE_ENTRY, propose_revenue))

    # ---- AR / AP ----
    def register_receivable(p):
        inv = invoice_from_dict(p["invoice"])
        key = s.duplicates.register(inv)
        s.kv.add("receivable", key, {"key": key, "customer": inv.counterparty_name, "amount": str(inv.total),
                                     "due": (inv.due_date or inv.issue_date).isoformat(), "paid": "0.00"})
        s.kv.add("invoice_sales", key, invoice_to_dict(inv))
        return {"key": key}
    reg(Tool("receivables.register", Op.MANAGE_RECEIVABLES, register_receivable))

    def aging(p):
        as_of = date.fromisoformat(p["as_of"])
        buckets = {"current": Decimal("0"), "1_30": Decimal("0"), "31_60": Decimal("0"),
                   "61_90": Decimal("0"), "over_90": Decimal("0")}
        for r in s.kv.list("receivable"):
            open_amt = to_money(r["amount"]) - to_money(r["paid"])
            if open_amt <= 0:
                continue
            days = (as_of - date.fromisoformat(r["due"])).days
            b = "current" if days <= 0 else "1_30" if days <= 30 else "31_60" if days <= 60 \
                else "61_90" if days <= 90 else "over_90"
            buckets[b] += open_amt
        return {k: str(to_money(v)) for k, v in buckets.items()}
    reg(Tool("receivables.aging", Op.MANAGE_RECEIVABLES, aging))

    def register_payable(p):
        inv = invoice_from_dict(p["invoice"])
        key = s.duplicates.register(inv)
        s.kv.add("payable", key, {"key": key, "vendor": inv.counterparty_name, "amount": str(inv.total),
                                  "due": (inv.due_date or inv.issue_date).isoformat(), "paid": "0.00"})
        s.kv.add("invoice_purchase", key, invoice_to_dict(inv))
        return {"key": key}
    reg(Tool("payables.register", Op.MANAGE_PAYABLES, register_payable))

    def execute_payment(p):
        bill = s.kv.get("payable", p["payable_key"])
        if bill is None:
            raise ValueError("unknown payable")
        amount = to_money(p["amount"])
        if amount <= 0 or amount > to_money(bill["amount"]) - to_money(bill["paid"]):
            raise ValueError("payment exceeds the open balance")
        bill["paid"] = str(to_money(bill["paid"]) + amount)
        s.kv.put("payable", p["payable_key"], bill)
        return {"status": "instruction_recorded", "note": "Transfer must be made in the bank portal by the owner."}
    reg(Tool("payables.execute_payment", Op.EXECUTE_PAYMENT, execute_payment,
             summarize=lambda p: f"Pay {p.get('amount')} SAR to {p.get('vendor')} for {p.get('payable_key')}"))

    # ---- payroll ----
    def payroll_compute(p):
        emps = [Employee(e["employee_id"], e["name"], e["is_saudi"], to_money(e["basic"]),
                         to_money(e.get("housing", "0")), to_money(e.get("other_allowances", "0")))
                for e in p["employees"]]
        run = compute_payroll(p["period"], emps, cfg.gosi_rates())
        entry = payroll_entry(run, date.fromisoformat(p["entry_date"]), tuple(p["document_ids"]), p["prepared_by"])
        return {"total_gross": str(run.total_gross), "total_net": str(run.total_net),
                "gosi_employee": str(run.total_gosi_employee), "gosi_employer": str(run.total_gosi_employer),
                "entry": entry_to_dict(entry)}
    reg(Tool("payroll.compute", Op.PREPARE_PAYROLL, payroll_compute))
    reg(Tool("payroll.pay", Op.EXECUTE_PAYROLL_PAYMENT,
             lambda p: {"status": "instruction_recorded", "note": "Run the WPS/Mudad payment from the bank."},
             summarize=lambda p: f"Pay payroll {p.get('period')}: {p.get('total_net')} SAR net"))

    # ---- bank ----
    def bank_reconcile(p):
        bank = [CashMovement(m["ref"], date.fromisoformat(m["on"]), m["amount"], m.get("description", ""))
                for m in p["bank"]]
        book = [CashMovement(m["ref"], date.fromisoformat(m["on"]), m["amount"], m.get("description", ""))
                for m in p["book"]]
        r = reconcile(bank, book, window_days=p.get("window_days", 3))
        return {"matched": [list(x) for x in r.matched],
                "unmatched_bank": [m.ref for m in r.unmatched_bank],
                "unmatched_book": [m.ref for m in r.unmatched_book],
                "difference": str(r.difference), "reconciled": r.is_reconciled}
    reg(Tool("bank.reconcile", Op.RECONCILE_BANK, bank_reconcile))
    reg(Tool("bank.update_account", Op.MODIFY_BANK_ACCOUNT,
             lambda p: {"status": "instruction_recorded"},
             summarize=lambda p: f"Change bank account {p.get('account')} → IBAN ending {str(p.get('iban', ''))[-4:]}"))

    # ---- reporting ----
    def financials(p):
        inc, bs = income_statement(s.ledger), balance_sheet(s.ledger)
        dr, cr = s.ledger.trial_balance()
        return {"revenue": str(inc.revenue), "expenses": str(inc.expenses), "net_income": str(inc.net_income),
                "assets": str(bs.assets), "liabilities": str(bs.liabilities), "equity": str(bs.equity),
                "balance_sheet_balances": bs.balances, "trial_balance": [str(dr), str(cr)]}
    reg(Tool("reports.financials", Op.GENERATE_REPORTS, financials))

    # ---- manager ----
    def post_staging(p):
        fp = s.ledger.post(entry_from_dict(p["entry"]))
        return {"fingerprint": fp}
    reg(Tool("ledger.post_staging", Op.POST_TO_STAGING_LEDGER, post_staging))

    def reverse_entry(p):
        fp = p["fingerprint"]
        orig = s.ledger.get(fp)
        if orig is None:
            raise ValueError("entry not found")
        rev = JournalEntry(date.fromisoformat(p["on"]), f"Reversal of {orig.reference}: {p['reason']}",
                           tuple(JournalLine(l.account_code, debit=l.credit, credit=l.debit, memo="reversal")
                                 for l in orig.lines),
                           orig.source_document_ids, "accounting_manager", f"REV-{orig.reference}")
        return {"fingerprint": s.ledger.post(rev)}        # reversal, never deletion
    reg(Tool("ledger.reverse_entry", Op.REVERSE_OR_DELETE_ENTRY, reverse_entry,
             summarize=lambda p: f"Reverse entry {p.get('fingerprint', '')[:10]}… — {p.get('reason')}"))

    def daftra_write(p):
        if not cfg.daftra_writes_enabled:
            raise WritesDisabled("Daftra writes are disabled in this deployment")
        return s.daftra.write_journal(p["entry"])
    reg(Tool("daftra.write_journal", Op.WRITE_DAFTRA, daftra_write,
             summarize=lambda p: f"Write journal {p.get('entry', {}).get('reference')} to Daftra"))
