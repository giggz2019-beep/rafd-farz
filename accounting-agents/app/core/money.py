"""Deterministic money arithmetic.

Every financial amount in the system is a ``Decimal`` quantized to the halala
(0.01 SAR). Floats are rejected outright: a float cannot represent most
decimal amounts exactly, and an accounting system that rounds silently is one
that drifts silently.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Iterable

HALALA = Decimal("0.01")
ZERO = Decimal("0.00")


class MoneyError(ValueError):
    pass


def to_money(value: object) -> Decimal:
    """Convert an int, str or Decimal to a SAR amount rounded to the halala.

    Rounding is ROUND_HALF_UP, the convention used on Saudi tax invoices.
    """
    if isinstance(value, bool) or isinstance(value, float):
        raise MoneyError(f"refusing to treat {type(value).__name__} {value!r} as money; pass str or Decimal")
    if isinstance(value, Decimal):
        d = value
    elif isinstance(value, (int, str)):
        try:
            d = Decimal(str(value).strip().replace(",", ""))
        except InvalidOperation as exc:
            raise MoneyError(f"not a number: {value!r}") from exc
    else:
        raise MoneyError(f"unsupported money type {type(value).__name__}")
    if not d.is_finite():
        raise MoneyError(f"non-finite amount: {value!r}")
    return d.quantize(HALALA, rounding=ROUND_HALF_UP)


def money_sum(values: Iterable[object]) -> Decimal:
    total = ZERO
    for v in values:
        total += to_money(v)
    return total.quantize(HALALA, rounding=ROUND_HALF_UP)


def mul(amount: object, factor: Decimal) -> Decimal:
    """amount × factor, rounded once at the end."""
    return (to_money(amount) * factor).quantize(HALALA, rounding=ROUND_HALF_UP)
