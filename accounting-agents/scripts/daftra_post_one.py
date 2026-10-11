"""Post ONE balanced two-line journal to Daftra through the safe write path.

    DAFTRA_WRITES_ENABLED=true python scripts/daftra_post_one.py \
        --tag AI-INBOX-2026-10-11 --ref inbox:1a12c3fa194e38ea --date 2026-10-07 \
        --dr 5207 --cr 1211 --amount 248.70 --desc "UltaHost VPS — invoice 916259" [--question "..."]

Accounts are Daftra CODES (not ids). The journal number is built from --ref, so posting the same
invoice twice is impossible: if that number already exists in Daftra the script says so and exits 0
without writing. --question marks the entry as parked in the suspense account. Writes nothing
unless DAFTRA_WRITES_ENABLED=true; the API key comes from the egress proxy (or DAFTRA_API_KEY).
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.daftra.adapter import DaftraConfig, HttpDaftraAdapter, tag_prefix  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    for a in ("--tag", "--ref", "--date", "--dr", "--cr", "--amount", "--desc"):
        ap.add_argument(a, required=True)
    ap.add_argument("--question", default="")
    a = ap.parse_args()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", a.date):
        raise SystemExit("--date must be YYYY-MM-DD")
    amount = Decimal(a.amount).quantize(Decimal("0.01"))
    if amount <= 0:
        raise SystemExit("--amount must be positive")
    number = tag_prefix(a.tag) + re.sub(r"[^A-Za-z0-9]", "", a.ref)[-24:]
    cfg = DaftraConfig(base_url=os.environ.get("DAFTRA_BASE_URL", "https://rafd1.daftra.com"),
                       journals_path="/api2/journals.json", accounts_path="/api2/journal_accounts.json",
                       auth_header=os.environ.get("DAFTRA_AUTH_HEADER", "APIKEY"),
                       api_key=os.environ.get("DAFTRA_API_KEY", ""), auth_via_proxy=not os.environ.get("DAFTRA_API_KEY"),
                       writes_enabled=os.environ.get("DAFTRA_WRITES_ENABLED", "").lower() == "true")
    d = HttpDaftraAdapter(cfg)
    accts, page = {}, 1
    while True:
        rows = d._get(cfg.accounts_path, {"page": page, "limit": 100})
        data = rows.get("data", []) if isinstance(rows, dict) else rows
        accts.update({x["JournalAccount"]["code"]: int(x["JournalAccount"]["id"]) for x in data})
        if not (isinstance(rows, dict) and (rows.get("pagination") or {}).get("next")):
            break
        page += 1
    for code in (a.dr, a.cr):
        if code not in accts:
            raise SystemExit(f"account code {code} does not exist in Daftra")
    page = 1
    while True:
        rows = d._get(cfg.journals_path, {"page": page, "limit": 100})
        # The run date is part of the number, so a later run would build a different one for the same
        # invoice: the reference in the description is what makes it the same invoice on any day.
        for x in rows.get("data", []):
            j = x.get("Journal") or {}
            if str(j.get("number")) == number or f"({a.ref})" in str(j.get("description", "")):
                print(f"already posted: {a.ref} as {j.get('number')} — nothing written")
                return 0
        if not (rows.get("pagination") or {}).get("next"):
            break
        page += 1
    desc = f"[{a.tag}] {a.desc} ({a.ref})" + (f" — سؤال مفتوح: {a.question}" if a.question else "")
    jid = d.post_journal(date=a.date, description=desc[:500], number=number, tag=a.tag,
                         lines=[(accts[a.dr], amount, Decimal("0"), a.desc[:200]),
                                (accts[a.cr], Decimal("0"), amount, a.desc[:200])])
    print(f"posted {number} id={jid}: {a.dr} / {a.cr} {amount}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
