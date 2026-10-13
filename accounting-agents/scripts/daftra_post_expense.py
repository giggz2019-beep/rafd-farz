"""Post ONE invoice to Daftra as an EXPENSE record, so it shows on the dashboard and in the analytics.

    DAFTRA_WRITES_ENABLED=true python scripts/daftra_post_expense.py \
        --tag AI-INBOX-2026-10-12 --ref inbox:1a12c3fa194e38ea --date 2026-10-07 \
        --account 5207 --paid-from 120102 --amount 248.70 --vendor UltaHost \
        --category "اشتراكات برمجية" --desc "UltaHost VPS — invoice 916259"

Daftra's dashboard reads the Expenses module, not manual journals, so a classified invoice goes here.
An expense always withdraws from a treasury; each payment account is bound to one (set up 2026-10-12):

    1202001 company Al Rajhi  -> treasury 2      1202003 STC bank (temporary) -> treasury 4
    120102  company card 1146 -> treasury 5      33 owner paid personally     -> treasury 1 (clearing)

Treasury 1 «مدفوعات المالكة نيابة عن الشركة» is a clearing treasury that always ends at zero: an
owner-paid invoice is a tagged journal Dr 120101 / Cr 33 plus an expense out of treasury 1, so 33
records what the company owes her and no treasury shows money it does not hold.

An invoice with an open question (unclear account or payer) is NOT posted here — it goes to the
suspense account with scripts/daftra_post_one.py. The ref is written into the expense note; an expense
whose note already carries it means the invoice was handled, and nothing is written (Daftra does not
echo `unique_id` back, so it cannot be relied on alone). Writes nothing unless DAFTRA_WRITES_ENABLED=true.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.daftra.adapter import DaftraConfig, HttpDaftraAdapter, WritesDisabled, tag_prefix  # noqa: E402

TREASURY_OF = {"1202001": 2, "1202003": 4, "120102": 5, "33": 1}
CLEARING_ACCOUNT = "120101"   # the account behind treasury 1
NEVER = {"1202002"}           # the owner's PERSONAL account — never carries a company entry


def main() -> int:
    ap = argparse.ArgumentParser()
    for a in ("--tag", "--ref", "--date", "--account", "--paid-from", "--amount", "--vendor", "--category", "--desc"):
        ap.add_argument(a, required=True)
    a = ap.parse_args()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", a.date):
        raise SystemExit("--date must be YYYY-MM-DD")
    if not re.fullmatch(r"52\d\d", a.account):
        raise SystemExit("--account must be an expense account (52xx)")
    if a.paid_from in NEVER or a.paid_from not in TREASURY_OF:
        raise SystemExit(f"--paid-from must be one of {sorted(TREASURY_OF)}; anything else goes to suspense "
                         "with scripts/daftra_post_one.py")
    amount = Decimal(a.amount).quantize(Decimal("0.01"))
    if amount <= 0:
        raise SystemExit("--amount must be positive")

    writes = os.environ.get("DAFTRA_WRITES_ENABLED", "").lower() == "true"
    cfg = DaftraConfig(base_url=os.environ.get("DAFTRA_BASE_URL", "https://rafd1.daftra.com"),
                       journals_path="/api2/journals.json", accounts_path="/api2/journal_accounts.json",
                       auth_header=os.environ.get("DAFTRA_AUTH_HEADER", "APIKEY"),
                       api_key=os.environ.get("DAFTRA_API_KEY", ""), auth_via_proxy=not os.environ.get("DAFTRA_API_KEY"),
                       writes_enabled=writes)
    d = HttpDaftraAdapter(cfg)

    accts, page = {}, 1
    while True:
        rows = d._get(cfg.accounts_path, {"page": page, "limit": 100})
        accts.update({x["JournalAccount"]["code"]: int(x["JournalAccount"]["id"]) for x in rows.get("data", [])})
        if not (rows.get("pagination") or {}).get("next"):
            break
        page += 1
    for code in (a.account, CLEARING_ACCOUNT, "33"):
        if code not in accts:
            raise SystemExit(f"account code {code} does not exist in Daftra")

    marker = f"({a.ref})"
    page = 1
    while True:
        rows = d._get("/api2/expenses.json", {"page": page, "limit": 100})
        for x in rows.get("data", []):
            if marker in str((x.get("Expense") or {}).get("note", "")):
                print(f"already posted: {a.ref} as expense {x['Expense'].get('id')} — nothing written")
                return 0
        if not (rows.get("pagination") or {}).get("next"):
            break
        page += 1

    note = f"[{a.tag}] {a.desc} {marker}"
    if a.paid_from == "33":
        note += " — دفعته المالكة من حسابها الشخصي (جاري المالكة 33)"
    if not writes:
        raise WritesDisabled("DAFTRA_WRITES_ENABLED is not true — nothing written")

    if a.paid_from == "33":
        number = tag_prefix(a.tag) + re.sub(r"[^A-Za-z0-9]", "", a.ref)[-24:]
        jid = d.post_journal(date=a.date, number=number, tag=a.tag,
                             description=f"[{a.tag}] مدفوعات المالكة نيابة عن الشركة — {a.desc} {marker}"[:500],
                             lines=[(accts[CLEARING_ACCOUNT], amount, Decimal("0"), a.desc[:200]),
                                    (accts["33"], Decimal("0"), amount, a.desc[:200])])
        print(f"owner-paid: journal {jid} Dr {CLEARING_ACCOUNT} / Cr 33 {amount}")

    body = {"Expense": {"amount": float(amount), "date": a.date, "currency_code": "SAR", "vendor": a.vendor[:100],
                        "category": a.category, "treasury_id": TREASURY_OF[a.paid_from],
                        "journal_account_id": accts[a.account], "note": note[:500],
                        "unique_id": "AI-EXP-" + re.sub(r"[^A-Za-z0-9]", "", a.ref)[-40:]}}
    r = d.http.post("/api2/expenses.json", json=body)
    if r.status_code not in (200, 201, 202):
        raise SystemExit(f"expense not created: HTTP {r.status_code} {r.text[:300]} — if owner-paid, the clearing "
                         "journal above was posted: delete it with delete_journal(id, tag) or retry this script")
    print(f"posted expense {r.json().get('id')}: {a.account} from treasury {TREASURY_OF[a.paid_from]} {amount}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
