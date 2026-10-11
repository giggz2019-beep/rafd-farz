"""Read-only snapshot of a Daftra tenant: pages through every resource with GET and
writes one JSON file per resource plus a summary. There is no write path here.

    DAFTRA_BASE_URL=https://<tenant>.daftra.com python scripts/daftra_pull.py OUT_DIR

Auth follows daftra_probe.py: DAFTRA_AUTH_HEADER + DAFTRA_API_KEY if both are set,
otherwise the request goes out bare for a proxy to inject the credential.
Keep OUT_DIR outside the repository — it holds the company's books.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import httpx

RESOURCES = {
    "accounts": "/api2/journal_accounts.json",
    "account_cats": "/api2/journal_cats.json",
    "journals": "/api2/journals.json",
    "invoices": "/api2/invoices.json",
    "purchase_invoices": "/api2/purchase_invoices.json",
    "suppliers": "/api2/suppliers.json",
    "clients": "/api2/clients.json",
    "expenses": "/api2/expenses.json",
    "incomes": "/api2/incomes.json",
    "treasuries": "/api2/treasuries.json",
}
PAGE_SIZE = 100


def pull(c: httpx.Client, path: str) -> list[dict]:
    rows, page = [], 1
    while True:
        r = c.get(path, params={"page": page, "limit": PAGE_SIZE})
        r.raise_for_status()
        body = r.json()
        rows += body.get("data") or []
        pg = body.get("pagination") or {}
        if not pg.get("next") or page >= int(pg.get("page_count") or 0):
            return rows
        page += 1


def main() -> int:
    base = os.environ.get("DAFTRA_BASE_URL", "").rstrip("/")
    if not base or len(sys.argv) != 2:
        print("usage: DAFTRA_BASE_URL=... python scripts/daftra_pull.py OUT_DIR", file=sys.stderr)
        return 2
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    headers = {"Accept": "application/json"}
    name, key = os.environ.get("DAFTRA_AUTH_HEADER", ""), os.environ.get("DAFTRA_API_KEY", "")
    if name and key:
        headers[name] = key
    summary = {}
    with httpx.Client(base_url=base, headers=headers, timeout=30) as c:
        for res, path in RESOURCES.items():
            try:
                rows = pull(c, path)
            except httpx.HTTPError as exc:
                summary[res] = {"path": path, "error": str(exc)[:200]}
                continue
            (out / f"{res}.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1))
            summary[res] = {"path": path, "count": len(rows)}
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1))
    print(json.dumps(summary, ensure_ascii=False))
    return 1 if any("error" in v for v in summary.values()) else 0


if __name__ == "__main__":
    sys.exit(main())
