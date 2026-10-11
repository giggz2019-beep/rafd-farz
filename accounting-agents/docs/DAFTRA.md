# Daftra integration

## Status: read-only adapter, connected (GET only)

| | Status |
|---|---|
| `MockDaftraAdapter` | used by default and in all tests |
| `HttpDaftraAdapter` | read-only (`list_journals`, `get_journal`, `list_accounts`, `list_invoices`, `list_suppliers`, `list_expenses`), retries 429/5xx/network with backoff, never retries 4xx |
| Writes | **disabled**: `write_journal` raises `WritesDisabled`; even with the flag on it raises `NotImplementedError` |

## Live probe — 2026-10-11, second run (GET only, `scripts/daftra_probe.py`)

Tenant `https://rafd1.daftra.com` («شركة رفد الرقمية»), with a **new API key from the rafd1 account**, injected
by the egress proxy in the `APIKEY` header only (no `Authorization`). Every path answered **200**, so these
are now the defaults in `app/config.py` and `.env.example`:

| Setting | Value |
|---|---|
| `DAFTRA_BASE_URL` | `https://rafd1.daftra.com` |
| `DAFTRA_AUTH_HEADER` | `APIKEY` |
| `DAFTRA_JOURNALS_PATH` | `/api2/journals.json` |
| `DAFTRA_ACCOUNTS_PATH` | `/api2/journal_accounts.json` |
| `DAFTRA_INVOICES_PATH` | `/api2/invoices.json` |
| `DAFTRA_SUPPLIERS_PATH` | `/api2/suppliers.json` |
| `DAFTRA_EXPENSES_PATH` | `/api2/expenses.json` |

`DAFTRA_API_KEY` stays empty in the repo; the adapter refuses to start without it.

Response envelope (confirmed): `{"result":"successful","code":200,"data":[...],"pagination":{"page","page_count",
"total_results","next","prev"}}`; each row is wrapped in its model name (`{"JournalAccount": {...}}`). Paging with
`?page=N&limit=M` works. Also readable: `journal_cats`, `purchase_invoices`, `clients`, `incomes`, `treasuries`,
`staff`, `site_info`. `payments` and `purchase_invoice_payments` return 404 "Invalid Endpoint".

`scripts/daftra_pull.py OUT_DIR` pages through all of them (GET only) and writes one JSON per resource.
Keep `OUT_DIR` outside the repository.

### What the tenant held on 2026-10-11

| Resource | Rows |
|---|---|
| accounts (`journal_accounts`) | 27, every balance 0 |
| account categories (`journal_cats`) | 38, every total 0 |
| treasuries | 1 («Main Treasury», cash, balance 0, created 2026-10-07) |
| journals, invoices, purchase invoices, suppliers, clients, expenses, incomes | **0** |

The tenant is a fresh Daftra default set-up: no transactions yet, no VAT accounts, no bank account under
1202 البنك. The agent reports in `reports/2026-10-11/` work from this snapshot.

`rafd.daftra.com` (connection "Daftra") still fails: 401 on journals/accounts, 500 on the rest.

## Earlier probe — 2026-10-11, first run (superseded)

With the previous key every path returned 401 with `X-Proxy-Error: upstream auth failed` — Daftra refused the
key itself, which the new key fixed.

## What the official documentation confirms (docs.daftara.dev)

Gathered via search results; the site itself was blocked from the build environment, so confirm each
item on the live pages before configuring:

- REST/JSON API; API-key auth generated in **Settings → API → API Key**; OAuth2 also supported.
  (Authorization page: https://docs.daftara.dev/933385m0)
- Journals: "GET All Journals" (https://docs.daftara.dev/40945255e0), "GET Single Journal",
  "Add New Journal" — `POST /journals{format}` with a `Journal` header and `JournalTransaction[]`
  lines; debits must equal credits; the date must be in an open financial period
  (https://docs.daftara.dev/40945261e0), "Edit Journals", "Delete Journals".
- Modules exposed: invoicing, clients, inventory/products, accounting & expenses, HR, reporting.

## What you must fill in (nothing is guessed)

| Setting | Where to find it |
|---|---|
| `DAFTRA_BASE_URL` | the API base for your tenant, from the Getting Started page |
| `DAFTRA_JOURNALS_PATH` | the path of "GET All Journals" |
| `DAFTRA_AUTH_HEADER` | the header name on the Authorization page |
| `DAFTRA_API_KEY` | Settings → API → API Key in your Daftra account |
| `DAFTRA_ACCOUNTS_PATH`, `DAFTRA_INVOICES_PATH`, `DAFTRA_SUPPLIERS_PATH`, `DAFTRA_EXPENSES_PATH` | each read resource; a list call on an unset one raises `DaftraNotConfigured` |

Also confirm your Daftra plan includes API access.

## Enabling writes later (a separate, reviewed change)

1. Verify the "Add New Journal" body on the live docs and implement `write_journal` against it.
2. Add integration tests against a Daftra **test** company, never the live one.
3. Use a separate API key for writes if Daftra supports scoped keys; otherwise keep writes behind the
   existing `WRITE_DAFTRA` owner approval.
4. Only then set `DAFTRA_WRITES_ENABLED=true`.
