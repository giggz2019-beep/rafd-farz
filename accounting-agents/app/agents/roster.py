"""The ten accounting agents.

Each agent owns one responsibility, a toolset that is a subset of its role's
permissions, typed inputs/outputs, and its own system prompt in prompts/.
Amounts are always computed by deterministic tools; the model only decides
classifications and writes explanations, and both are schema-validated.
"""
from __future__ import annotations

import re
from typing import Literal

from ..core.ledger import AccountType
from ..security.permissions import Op, Role
from .base import Agent, AgentSpec, Strict

# --------------------------------------------------------------------------- outputs
EXPENSE_ACCOUNTS = Literal["5101", "5102", "5201", "5301", "5302", "5401", "5501", "5601", "5701", "5801", "1401", "1501"]
REVENUE_ACCOUNTS = Literal["4101", "4102", "4901"]


class ExpenseDecision(Strict):
    account_code: EXPENSE_ACCOUNTS
    confidence: Literal["low", "medium", "high"]
    rationale: str
    needs_human_review: bool


class RevenueDecision(Strict):
    revenue_account: REVENUE_ACCOUNTS
    recognition: Literal["immediate", "deferred"]
    rationale: str
    needs_human_review: bool


class AuditOpinion(Strict):
    recommendation: Literal["approve", "hold", "reject"]
    concerns: list[str]


class CollectionNote(Strict):
    message_ar: str
    tone: Literal["friendly", "firm"]


class ReconNote(Strict):
    likely_causes: list[str]
    next_steps: list[str]


class AnalystCommentary(Strict):
    headline: str
    observations: list[str]
    risks: list[str]


class ManagerNote(Strict):
    summary_ar: str


class Finding(Strict):
    code: str
    message: str
    severity: Literal["blocker", "warning"]
    source: str


class AuditReport(Strict):
    blockers: list[Finding]
    warnings: list[Finding]
    opinion: AuditOpinion | None = None


class ManagerDecision(Strict):
    action: Literal["post", "hold_for_owner", "reject"]
    reasons: list[str]
    conflict: bool = False


# --------------------------------------------------------------------------- agents
class AccountingManagerAgent(Agent):
    spec = AgentSpec(
        Role.ACCOUNTING_MANAGER, "Accounting Manager",
        "Coordinates the other agents, applies the posting policy, resolves conflicts, and is the only "
        "agent that posts to the staging ledger. Escalates anything uncertain to the owner.",
        frozenset({"ledger.post_staging", "ledger.reverse_entry", "daftra.write_journal",
                   "ledger.balances", "documents.verify", "daftra.list_journals"}))

    def decide_posting(self, audit: AuditReport, *, preparer_role: Role,
                       classifier_needs_review: bool, classifier_confidence: str | None) -> ManagerDecision:
        """Deterministic policy. The model never overrides it."""
        reasons: list[str] = []
        if preparer_role == self.role:
            return ManagerDecision(action="hold_for_owner", reasons=["segregation of duties: preparer is the poster"])
        if any(b.code == "DUPLICATE" for b in audit.blockers):
            return ManagerDecision(action="reject", reasons=[b.message for b in audit.blockers])
        if audit.blockers:
            return ManagerDecision(action="hold_for_owner", reasons=[b.message for b in audit.blockers])
        conflict = False
        if audit.opinion and audit.opinion.recommendation != "approve":
            reasons.append(f"internal audit recommends {audit.opinion.recommendation}: "
                           + "; ".join(audit.opinion.concerns))
            conflict = classifier_confidence == "high" and not classifier_needs_review
        if audit.warnings:
            reasons += [w.message for w in audit.warnings]
        if classifier_needs_review or classifier_confidence == "low":
            reasons.append("preparer flagged the classification for human review")
        if reasons:
            return ManagerDecision(action="hold_for_owner", reasons=reasons, conflict=conflict)
        return ManagerDecision(action="post", reasons=["all checks passed"])


class RevenueAccountantAgent(Agent):
    spec = AgentSpec(
        Role.REVENUE_ACCOUNTANT, "Revenue Accountant",
        "Recognises revenue from sales invoices: picks the revenue account and immediate vs deferred "
        "recognition, then has the deterministic tool build the entry.",
        frozenset({"revenue.propose_entry", "documents.verify", "ledger.balances"}))

    def propose(self, invoice: dict, context: dict, *, key: str) -> tuple[RevenueDecision, dict]:
        d = self.decide(RevenueDecision, {"invoice": invoice, "context": context}, key=key)
        entry = self.tool("revenue.propose_entry",
                          {"invoice": invoice, "revenue_account": d.revenue_account,
                           "deferred": d.recognition == "deferred", "prepared_by": self.role.value},
                          key=f"{key}:entry")
        return d, entry


class ExpenseAccountantAgent(Agent):
    spec = AgentSpec(
        Role.EXPENSE_ACCOUNTANT, "Expense Accountant",
        "Classifies purchase invoices to the chart of accounts and has the deterministic tool build the entry.",
        frozenset({"expense.propose_entry", "documents.verify", "ledger.balances"}))

    def propose(self, invoice: dict, *, key: str) -> tuple[ExpenseDecision, dict]:
        chart = {c: self.s.ledger.coa.get(c).name
                 for c in self.s.ledger.coa.codes(AccountType.EXPENSE) + ["1401", "1501"]}
        d = self.decide(ExpenseDecision, {"invoice": invoice, "chart_of_accounts": chart}, key=key)
        entry = self.tool("expense.propose_entry",
                          {"invoice": invoice, "account_code": d.account_code, "prepared_by": self.role.value},
                          key=f"{key}:entry")
        return d, entry


class AccountsReceivableAgent(Agent):
    spec = AgentSpec(
        Role.ACCOUNTS_RECEIVABLE, "Accounts Receivable",
        "Tracks what customers owe: registers sales invoices, produces the aging report, drafts "
        "(never sends) collection reminders.",
        frozenset({"receivables.register", "receivables.aging"}))

    def register(self, invoice: dict, *, key: str) -> dict:
        return self.tool("receivables.register", {"invoice": invoice}, key=key)

    def aging(self, as_of: str, *, key: str) -> dict:
        return self.tool("receivables.aging", {"as_of": as_of}, key=key)

    def draft_reminder(self, customer: str, amount: str, days_overdue: int, *, key: str) -> CollectionNote:
        return self.decide(CollectionNote, {"customer": customer, "amount_sar": amount,
                                            "days_overdue": days_overdue}, key=key)


class AccountsPayableAgent(Agent):
    spec = AgentSpec(
        Role.ACCOUNTS_PAYABLE, "Accounts Payable",
        "Tracks what the company owes: registers purchase invoices and requests vendor payments. "
        "Every payment needs the owner's approval.",
        frozenset({"payables.register", "payables.execute_payment"}))

    def register(self, invoice: dict, *, key: str) -> dict:
        return self.tool("payables.register", {"invoice": invoice}, key=key)

    def pay(self, payable_key: str, vendor: str, amount: str, *, key: str, approval_id: str | None = None) -> dict:
        return self.tool("payables.execute_payment",
                         {"payable_key": payable_key, "vendor": vendor, "amount": amount},
                         key=key, approval_id=approval_id)


class PayrollAccountantAgent(Agent):
    spec = AgentSpec(
        Role.PAYROLL_ACCOUNTANT, "Payroll Accountant",
        "Computes payroll and GOSI deductions and prepares the payroll entry. Paying salaries needs the "
        "owner's approval.",
        frozenset({"payroll.compute", "payroll.pay"}))

    def prepare(self, period: str, employees: list[dict], entry_date: str, document_ids: list[str], *, key: str) -> dict:
        return self.tool("payroll.compute", {"period": period, "employees": employees, "entry_date": entry_date,
                                             "document_ids": document_ids, "prepared_by": self.role.value}, key=key)

    def pay(self, period: str, total_net: str, *, key: str, approval_id: str | None = None) -> dict:
        return self.tool("payroll.pay", {"period": period, "total_net": total_net}, key=key, approval_id=approval_id)


class VatAccountantAgent(Agent):
    spec = AgentSpec(
        Role.VAT_ACCOUNTANT, "Saudi VAT Accountant",
        "Validates VAT on every invoice, monitors the registration threshold, and prepares VAT returns. "
        "Filing is done by the owner on the ZATCA portal after approval.",
        frozenset({"vat.validate_invoice", "vat.prepare_return", "vat.submit_return"}))

    def validate(self, invoice: dict, *, key: str) -> list[dict]:
        return self.tool("vat.validate_invoice", {"invoice": invoice}, key=key)["issues"]

    def prepare_return(self, period: str, *, key: str) -> dict:
        return self.tool("vat.prepare_return", {"period": period}, key=key)

    def submit_return(self, summary: dict, *, key: str, approval_id: str | None = None) -> dict:
        return self.tool("vat.submit_return", summary, key=key, approval_id=approval_id)


class BankReconciliationAgent(Agent):
    spec = AgentSpec(
        Role.BANK_RECONCILIATION, "Bank Reconciliation",
        "Matches bank statement lines to booked cash movements and explains the differences.",
        frozenset({"bank.reconcile", "bank.update_account", "daftra.list_journals", "ledger.balances"}))

    def reconcile(self, bank: list[dict], book: list[dict], *, key: str) -> dict:
        return self.tool("bank.reconcile", {"bank": bank, "book": book}, key=key)

    def explain(self, result: dict, *, key: str) -> ReconNote:
        return self.decide(ReconNote, result, key=key)


_NUM = re.compile(r"\d[\d,]*(?:\.\d+)?")


class FinancialAnalystAgent(Agent):
    spec = AgentSpec(
        Role.FINANCIAL_ANALYST, "Financial Analyst",
        "Produces the financial statements from the ledger and a plain-language commentary for the owner.",
        frozenset({"reports.financials", "ledger.balances", "daftra.list_journals"}), effort="high")

    def report(self, *, key: str) -> dict:
        return self.tool("reports.financials", {}, key=key)

    def commentary(self, figures: dict, *, key: str) -> tuple[AnalystCommentary | None, list[str]]:
        """Any number in the commentary must appear in the figures, or the commentary is withheld."""
        note = self.decide(AnalystCommentary, figures, key=key)
        allowed = {v.replace(",", "") for v in figures.values() if isinstance(v, str)}
        allowed |= {a.split(".")[0] for a in allowed}
        text = " ".join([note.headline, *note.observations, *note.risks])
        bad = [n for n in _NUM.findall(text) if n.replace(",", "") not in allowed and len(n.replace(",", "")) > 2]
        if bad:
            self.s.audit.record(self.role.value, "commentary.withheld", key, "flagged", {"unsupported_numbers": bad})
            return None, bad
        return note, []


class InternalAuditAgent(Agent):
    spec = AgentSpec(
        Role.INTERNAL_AUDIT, "Internal Audit",
        "Independently reviews every proposed entry: duplicates, documentation, VAT, double-entry integrity, "
        "and the audit-log chain. Can block; cannot post, pay, or approve.",
        frozenset({"invoices.check_duplicate", "audit.review_entry", "audit.verify_chain",
                   "documents.verify", "ledger.balances", "daftra.list_journals"}), effort="high")

    def review(self, invoice: dict, entry: dict, vat_issues: list[dict], *, key: str,
               with_opinion: bool = True) -> AuditReport:
        blockers: list[Finding] = []
        warnings: list[Finding] = []
        doc = self.tool("documents.verify", {"document_id": invoice.get("document_id")}, key=f"{key}:doc")
        if not doc["ok"]:
            blockers.append(Finding(code="MISSING_DOCUMENT", message="supporting document missing",
                                    severity="blocker", source="documents"))
        dup = self.tool("invoices.check_duplicate", {"invoice": invoice}, key=f"{key}:dup")
        if dup["verdict"] == "duplicate":
            blockers.append(Finding(code="DUPLICATE", message=f"duplicate of {dup['existing']}",
                                    severity="blocker", source="duplicates"))
        elif dup["verdict"] == "possible_duplicate":
            warnings.append(Finding(code="POSSIBLE_DUPLICATE", message=f"looks like {dup['existing']}",
                                    severity="warning", source="duplicates"))
        for i in self.tool("audit.review_entry", {"entry": entry}, key=f"{key}:entry")["issues"]:
            blockers.append(Finding(code=i["code"], message=i["message"], severity="blocker", source="ledger"))
        for v in vat_issues:
            if v.get("severity") == "info":
                continue                                  # recorded in the VAT step, does not hold the entry
            (blockers if v.get("severity", "error") == "error" else warnings).append(
                Finding(code=v["code"], message=v["message"],
                        severity="blocker" if v.get("severity", "error") == "error" else "warning", source="vat"))
        opinion = None
        if with_opinion and self.llm is not None:
            opinion = self.decide(AuditOpinion, {"invoice": invoice, "entry": entry,
                                                 "deterministic_findings": [f.model_dump() for f in blockers + warnings]},
                                  key=f"{key}:opinion")
        return AuditReport(blockers=blockers, warnings=warnings, opinion=opinion)


ALL_AGENTS: tuple[type[Agent], ...] = (
    AccountingManagerAgent, RevenueAccountantAgent, ExpenseAccountantAgent, AccountsReceivableAgent,
    AccountsPayableAgent, PayrollAccountantAgent, VatAccountantAgent, BankReconciliationAgent,
    FinancialAnalystAgent, InternalAuditAgent,
)
