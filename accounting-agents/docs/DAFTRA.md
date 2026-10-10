# Daftra integration

## Status: read-only adapter, not yet connected

| | Status |
|---|---|
| `MockDaftraAdapter` | used by default and in all tests |
| `HttpDaftraAdapter` | read-only (`list_journals`, `get_journal`), retries 429/5xx/network with backoff, never retries 4xx |
| Writes | **disabled**: `write_journal` raises `WritesDisabled`; even with the flag on it raises `NotImplementedError` |

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

Also confirm your Daftra plan includes API access.

## Enabling writes later (a separate, reviewed change)

1. Verify the "Add New Journal" body on the live docs and implement `write_journal` against it.
2. Add integration tests against a Daftra **test** company, never the live one.
3. Use a separate API key for writes if Daftra supports scoped keys; otherwise keep writes behind the
   existing `WRITE_DAFTRA` owner approval.
4. Only then set `DAFTRA_WRITES_ENABLED=true`.
