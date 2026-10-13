"""Double-entry ledger: chart of accounts, journal entries, validation, reports."""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from enum import Enum

from ..storage.kv import KV, MemoryKV
from .money import ZERO, money_sum, to_money


class AccountType(str, Enum):
    ASSET = "asset"
    LIABILITY = "liability"
    EQUITY = "equity"
    REVENUE = "revenue"
    EXPENSE = "expense"


@dataclass(frozen=True)
class Account:
    code: str
    name: str
    type: AccountType


# A starter chart for a Saudi technology LLC. Codes follow the common
# 1-asset / 2-liability / 3-equity / 4-revenue / 5-expense convention.
DEFAULT_ACCOUNTS: tuple[Account, ...] = (
    Account("1101", "Cash at bank - Al Rajhi", AccountType.ASSET),
    Account("1102", "Cash at bank - secondary", AccountType.ASSET),
    Account("1201", "Accounts receivable", AccountType.ASSET),
    Account("1301", "Input VAT recoverable", AccountType.ASSET),
    Account("1401", "Prepaid expenses", AccountType.ASSET),
    Account("1501", "Computer equipment", AccountType.ASSET),
    Account("2101", "Accounts payable", AccountType.LIABILITY),
    Account("2102", "Company credit card", AccountType.LIABILITY),
    Account("2201", "Output VAT payable", AccountType.LIABILITY),
    Account("2301", "Customer advances (deferred revenue)", AccountType.LIABILITY),
    Account("2401", "Salaries payable", AccountType.LIABILITY),
    Account("2402", "GOSI payable", AccountType.LIABILITY),
    Account("2501", "Due to owner (current account)", AccountType.LIABILITY),
    Account("2601", "Zakat provision", AccountType.LIABILITY),
    Account("3101", "Share capital", AccountType.EQUITY),
    Account("3201", "Retained earnings", AccountType.EQUITY),
    Account("4101", "Software & AI services revenue", AccountType.REVENUE),
    Account("4102", "Camera monitoring subscriptions", AccountType.REVENUE),
    Account("4901", "Government grants & other income", AccountType.REVENUE),
    Account("5101", "Software subscriptions & AI APIs", AccountType.EXPENSE),
    Account("5102", "Hosting & domains", AccountType.EXPENSE),
    Account("5201", "Marketing & advertising", AccountType.EXPENSE),
    Account("5301", "Salaries & wages", AccountType.EXPENSE),
    Account("5302", "GOSI - employer contribution", AccountType.EXPENSE),
    Account("5401", "Government fees & registrations", AccountType.EXPENSE),
    Account("5501", "Rent", AccountType.EXPENSE),
    Account("5601", "Freelancers & professional fees", AccountType.EXPENSE),
    Account("5701", "Bank charges", AccountType.EXPENSE),
    Account("5801", "Office & general expenses", AccountType.EXPENSE),
    Account("5901", "Zakat expense", AccountType.EXPENSE),
)


class ChartOfAccounts:
    def __init__(self, accounts: tuple[Account, ...] = DEFAULT_ACCOUNTS):
        self._by_code = {a.code: a for a in accounts}
        if len(self._by_code) != len(accounts):
            raise ValueError("duplicate account codes")

    def get(self, code: str) -> Account | None:
        return self._by_code.get(code)

    def codes(self, type_: AccountType | None = None) -> list[str]:
        return sorted(c for c, a in self._by_code.items() if type_ is None or a.type == type_)

    def __contains__(self, code: str) -> bool:
        return code in self._by_code


@dataclass(frozen=True)
class JournalLine:
    account_code: str
    debit: Decimal = ZERO
    credit: Decimal = ZERO
    memo: str = ""

    def __post_init__(self):
        object.__setattr__(self, "debit", to_money(self.debit))
        object.__setattr__(self, "credit", to_money(self.credit))


@dataclass(frozen=True)
class JournalEntry:
    entry_date: date
    description: str
    lines: tuple[JournalLine, ...]
    source_document_ids: tuple[str, ...] = ()
    prepared_by: str = ""
    reference: str = ""

    def fingerprint(self) -> str:
        """Content hash — the idempotency key for posting this entry."""
        payload = {
            "date": self.entry_date.isoformat(), "ref": self.reference,
            "lines": [[l.account_code, str(l.debit), str(l.credit)] for l in self.lines],
            "docs": sorted(self.source_document_ids),
        }
        return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()

    @property
    def total_debit(self) -> Decimal:
        return money_sum(l.debit for l in self.lines)

    @property
    def total_credit(self) -> Decimal:
        return money_sum(l.credit for l in self.lines)


@dataclass(frozen=True)
class EntryIssue:
    code: str
    message: str


def validate_entry(entry: JournalEntry, coa: ChartOfAccounts, *, require_documents: bool = True) -> list[EntryIssue]:
    issues: list[EntryIssue] = []
    if len(entry.lines) < 2:
        issues.append(EntryIssue("TOO_FEW_LINES", "a journal entry needs at least two lines"))
    for i, ln in enumerate(entry.lines, 1):
        if ln.account_code not in coa:
            issues.append(EntryIssue("UNKNOWN_ACCOUNT", f"line {i}: account {ln.account_code} is not in the chart"))
        if ln.debit < 0 or ln.credit < 0:
            issues.append(EntryIssue("NEGATIVE_AMOUNT", f"line {i}: negative amount"))
        if (ln.debit > 0) == (ln.credit > 0):
            issues.append(EntryIssue("ONE_SIDE_PER_LINE", f"line {i}: must have exactly one of debit or credit"))
    if entry.total_debit != entry.total_credit:
        issues.append(EntryIssue("UNBALANCED",
                                 f"debits {entry.total_debit} ≠ credits {entry.total_credit}"))
    if require_documents and not entry.source_document_ids:
        issues.append(EntryIssue("MISSING_DOCUMENT", "no supporting document attached"))
    if not entry.description.strip():
        issues.append(EntryIssue("NO_DESCRIPTION", "description is required"))
    return issues


class UnbalancedEntryError(ValueError):
    pass


class Ledger:
    """Staging ledger persisted through a KV. Posting is insert-only and
    idempotent on the entry fingerprint; corrections are reversals."""
    NS = "journal"

    def __init__(self, coa: ChartOfAccounts | None = None, kv: KV | None = None):
        self.coa = coa or ChartOfAccounts()
        self.kv = kv or MemoryKV()

    def post(self, entry: JournalEntry) -> str:
        from .serde import entry_to_dict
        issues = validate_entry(entry, self.coa)
        if issues:
            raise UnbalancedEntryError("; ".join(f"{i.code}: {i.message}" for i in issues))
        fp = entry.fingerprint()
        self.kv.add(self.NS, fp, {"fingerprint": fp, **entry_to_dict(entry)})
        return fp

    def get(self, fingerprint: str) -> JournalEntry | None:
        from .serde import entry_from_dict
        d = self.kv.get(self.NS, fingerprint)
        return entry_from_dict(d) if d else None

    @property
    def entries(self) -> dict[str, JournalEntry]:
        from .serde import entry_from_dict
        return {d["fingerprint"]: entry_from_dict(d) for d in self.kv.list(self.NS)}

    def balances(self) -> dict[str, Decimal]:
        """Signed balance per account: debit-positive."""
        bal: dict[str, Decimal] = {}
        for e in self.entries.values():
            for l in e.lines:
                bal[l.account_code] = bal.get(l.account_code, ZERO) + l.debit - l.credit
        return bal

    def trial_balance(self) -> tuple[Decimal, Decimal]:
        dr = cr = ZERO
        for e in self.entries.values():
            dr += e.total_debit
            cr += e.total_credit
        return dr, cr
