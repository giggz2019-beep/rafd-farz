"""Mapping from the agents' chart of accounts (app/core/ledger.py) to Daftra account codes.

The two charts use the same digits for different things — internal 5201 is "Marketing &
advertising", Daftra 5201 is "إيجار" (rent); internal 1201 is receivables, Daftra 1201 is the
treasury category — so an internal code must never be sent to Daftra as it is. Every code goes
through ``to_daftra``, and a code with no confirmed Daftra account is refused, not guessed.

Only accounts whose meaning matches an account that exists in the rafd1 tenant are mapped
(checked against GET /api2/journal_accounts.json on 2026-10-11, re-pulled the same day after
the bank account was added). The rest are ``None`` until the
owner creates the account in Daftra and its code is filled in here; ``check_mapping`` then
verifies the new code against a fresh snapshot (scripts/daftra_chart_check.py).

Daftra's ``type`` field reads as the account's normal balance — "1" on every asset and expense
account in the tenant, "0" on capital, revenue and liabilities. That is an inference from the
data, used only to catch a mapping onto an account of the opposite nature.
"""
from __future__ import annotations

from ..core.ledger import AccountType, ChartOfAccounts
from .adapter import DaftraError

DAFTRA_CODES: dict[str, str | None] = {
    # assets
    "1101": "1202001", # the company's Al Rajhi account (treasury 2 in Daftra), added 2026-10-11
    "1102": "1202003", # بنك STC (مؤقت) — salaries account, being wound down. NOT 1202002: that is the
                       # owner's PERSONAL Al Rajhi treasury and must carry no company entries
    "1201": None,      # receivables — Daftra keeps one account per client under 12041 العملاء
    "1301": None,      # input VAT — only once the company is VAT-registered
    "1401": None,      # prepaid expenses — no Daftra account yet
    "1501": None,      # computer equipment — create under 111002 الأجهزة والمعدات
    # liabilities
    "2101": None,      # payables — Daftra keeps one account per supplier under 2211 الموردون
    "2102": None,      # company credit card
    "2201": None,      # output VAT — only once the company is VAT-registered
    "2301": None,      # customer advances
    "2401": None,      # salaries payable
    "2402": None,      # GOSI payable
    "2501": "33",      # جاري المالكة (created by AI-BATCH-2026-10-11)
    "2601": None,      # zakat provision
    # equity
    "3101": "31",      # رأس المال
    "3201": "32",      # أرباح وخسائر مرحلة
    # revenue
    "4101": "413",     # إيرادات الخدمات (created by AI-BATCH-2026-10-11)
    "4102": None,      # camera monitoring subscriptions
    "4901": "4201",    # إيرادات أخرى
    # expenses
    "5101": "5207",    # مصروف اشتراكات برمجية (created by AI-BATCH-2026-10-11)
    "5102": None,      # hosting & domains
    "5201": "5209",    # marketing → مصروف تسويق وإعلان; NOT Daftra 5201, which is rent
    "5301": "5212",    # مصروف رواتب وأجور (created by AI-RECLASS-2026-10-11)
    "5302": "5208",    # مصروف التأمينات الاجتماعية (created by AI-BATCH-2026-10-11)
    "5401": "5206",    # مصاريف حكومية
    "5501": "5201",    # إيجار
    "5601": None,      # freelancers & professional fees
    "5701": "5211",    # مصروف رسوم بنكية (created by AI-BATCH-2026-10-11)
    "5801": None,      # office & general
    "5901": None,      # zakat expense
}

_DEBIT_NATURE = {AccountType.ASSET, AccountType.EXPENSE}


class UnmappedAccount(DaftraError):
    pass


def to_daftra(code: str) -> str:
    if code not in DAFTRA_CODES:
        raise UnmappedAccount(f"account {code} is not in the agents' chart")
    target = DAFTRA_CODES[code]
    if target is None:
        raise UnmappedAccount(f"account {code} has no Daftra account yet — create it in Daftra and map it "
                              "in app/daftra/chart_map.py")
    return target


def unmapped(mapping: dict[str, str | None] = DAFTRA_CODES) -> list[str]:
    return sorted(c for c, t in mapping.items() if t is None)


def check_mapping(chart: ChartOfAccounts, daftra_accounts: list[dict],
                  mapping: dict[str, str | None] = DAFTRA_CODES) -> list[str]:
    """Problems with the mapping against a Daftra snapshot ([{code, name, type}, ...]).
    Unmapped codes are not problems — they are listed by ``unmapped``."""
    problems: list[str] = []
    internal = set(chart.codes())
    problems += [f"{c}: in the agents' chart but missing from the mapping" for c in sorted(internal - set(mapping))]
    problems += [f"{c}: mapped but not in the agents' chart" for c in sorted(set(mapping) - internal)]
    daftra = {str(a["code"]): a for a in daftra_accounts}
    seen: dict[str, str] = {}
    for code, target in sorted(mapping.items()):
        if target is None or code not in internal:
            continue
        if target in seen:
            problems.append(f"{code}: maps to Daftra {target}, already used by {seen[target]}")
        seen[target] = code
        acct = daftra.get(target)
        if acct is None:
            problems.append(f"{code}: Daftra account {target} does not exist")
            continue
        debit = chart.get(code).type in _DEBIT_NATURE
        if str(acct.get("type")) != ("1" if debit else "0"):
            problems.append(f"{code} ({chart.get(code).type.value}) maps to Daftra {target} "
                            f"«{acct.get('name')}», whose balance is the other side")
    return problems
