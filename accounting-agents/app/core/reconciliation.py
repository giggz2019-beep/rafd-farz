"""Bank reconciliation: match bank lines to book cash movements (deterministic)."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from .money import ZERO, money_sum, to_money


@dataclass(frozen=True)
class CashMovement:
    ref: str
    on: date
    amount: Decimal       # + money in, − money out
    description: str = ""

    def __post_init__(self):
        object.__setattr__(self, "amount", to_money(self.amount))


@dataclass(frozen=True)
class ReconciliationResult:
    matched: tuple[tuple[str, str], ...]          # (bank ref, book ref)
    unmatched_bank: tuple[CashMovement, ...]
    unmatched_book: tuple[CashMovement, ...]
    bank_total: Decimal
    book_total: Decimal

    @property
    def difference(self) -> Decimal:
        return self.bank_total - self.book_total

    @property
    def is_reconciled(self) -> bool:
        return not self.unmatched_bank and not self.unmatched_book and self.difference == ZERO


def reconcile(bank: list[CashMovement], book: list[CashMovement], *, window_days: int = 3) -> ReconciliationResult:
    """One-to-one match on exact amount within ±window_days, nearest date first.

    Ties are broken by reference order so the result is deterministic.
    """
    remaining = sorted(book, key=lambda m: (m.on, m.ref))
    matched: list[tuple[str, str]] = []
    unmatched_bank: list[CashMovement] = []
    for b in sorted(bank, key=lambda m: (m.on, m.ref)):
        best = None
        for cand in remaining:
            if cand.amount != b.amount:
                continue
            gap = abs((cand.on - b.on).days)
            if gap <= window_days and (best is None or gap < best[0]):
                best = (gap, cand)
        if best:
            remaining.remove(best[1])
            matched.append((b.ref, best[1].ref))
        else:
            unmatched_bank.append(b)
    return ReconciliationResult(tuple(matched), tuple(unmatched_bank), tuple(remaining),
                                money_sum(m.amount for m in bank), money_sum(m.amount for m in book))
