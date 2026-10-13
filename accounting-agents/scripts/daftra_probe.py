"""Read-only connectivity probe for a Daftra tenant.

Sends GET requests only — there is no code path here that can write. Prints, per
candidate path, the HTTP status, the NAMES of the auth headers sent (never their
values) and any X-Proxy-Error the egress proxy adds. Use it to confirm
DAFTRA_JOURNALS_PATH / DAFTRA_AUTH_HEADER before setting them.

    DAFTRA_BASE_URL=https://<tenant>.daftra.com python scripts/daftra_probe.py

With DAFTRA_API_KEY set and DAFTRA_AUTH_HEADER naming a header, the key is sent
in that header. Without a key the request goes out bare, which is right when a
proxy injects the credential.
"""
from __future__ import annotations

import json
import os
import sys

import httpx

CANDIDATES = {
    "journals": "/api2/journals.json",
    "accounts": "/api2/journal_accounts.json",
    "invoices": "/api2/invoices.json",
    "suppliers": "/api2/suppliers.json",
    "expenses": "/api2/expenses.json",
}


def main() -> int:
    base = os.environ.get("DAFTRA_BASE_URL", "").rstrip("/")
    if not base:
        print("DAFTRA_BASE_URL is not set", file=sys.stderr)
        return 2
    headers = {"Accept": "application/json"}
    name, key = os.environ.get("DAFTRA_AUTH_HEADER", ""), os.environ.get("DAFTRA_API_KEY", "")
    if name and key:
        headers[name] = key
    sent = sorted(h for h in headers if h.lower() != "accept")
    ok = True
    with httpx.Client(base_url=base, headers=headers, timeout=20) as c:
        for res, path in CANDIDATES.items():
            r = c.get(path, params={"limit": 1})
            row = {"resource": res, "path": path, "status": r.status_code,
                   "auth_headers_sent_by_client": sent or ["(none — proxy-injected if configured)"],
                   "x_proxy_error": r.headers.get("x-proxy-error")}
            if r.status_code >= 400:
                ok = False
                row["body"] = r.text[:200]
            print(json.dumps(row, ensure_ascii=False))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
