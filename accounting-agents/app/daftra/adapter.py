"""Daftra integration adapter — READ-ONLY.

What is confirmed (docs.daftara.dev, via search; the pages themselves could not
be fetched from the build environment, so re-check before enabling):
- Daftra exposes a REST/JSON API; auth by an API key generated in
  Settings → API → API Key (OAuth2 also offered).
- A Journals resource exists: "GET All Journals", "GET Single Journal",
  "Add New Journal" (POST /journals{format}), "Edit Journals", "Delete Journals".
  POST validates that debits equal credits and that the date is in an open period.

What is NOT confirmed and therefore NOT hard-coded:
- the base URL shape for a tenant, the exact path prefix, and the auth header
  name. They are required settings (DAFTRA_BASE_URL, DAFTRA_JOURNALS_PATH,
  DAFTRA_AUTH_HEADER); the HTTP adapter refuses to start without them.

Writes (verified against docs.daftara.dev on 2026-10-11): ``POST /api2/journal_accounts.json``
(``{"JournalAccount": {journal_cat_id, code, name, type}}``), ``POST /api2/journals.json``
(``{"Journal": {date, description, number, currency_code, draft}, "JournalTransaction":
[{journal_account_id, currency_debit, currency_credit, description}]}``) and
``DELETE /api2/journals/{id}.json``. Every write goes through ``_guard`` and refuses unless
DAFTRA_WRITES_ENABLED is true, and every journal must carry the batch tag in its description and a
number with the batch prefix — so a batch can always be found again and rolled back by its tag.
A POST is sent once and never retried: a retried POST could book an entry twice, so the caller
re-reads by number instead.
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass
from decimal import Decimal
from typing import Protocol

import httpx


class DaftraError(RuntimeError):
    pass


class DaftraUnavailable(DaftraError):
    """Retryable: timeout, connection error, 5xx, 429."""


class DaftraNotConfigured(DaftraError):
    pass


class WritesDisabled(DaftraError):
    pass


class WriteRefused(DaftraError):
    """A write that would break a safety rule (untagged, unbalanced, non-positive)."""


class DaftraAdapter(Protocol):
    def list_journals(self, page: int = 1) -> list[dict]: ...
    def get_journal(self, journal_id: str) -> dict: ...
    def list_accounts(self, page: int = 1) -> list[dict]: ...
    def list_invoices(self, page: int = 1) -> list[dict]: ...
    def list_suppliers(self, page: int = 1) -> list[dict]: ...
    def list_expenses(self, page: int = 1) -> list[dict]: ...
    def write_journal(self, entry: dict) -> dict: ...


def tag_prefix(tag: str) -> str:
    """AI-BATCH-2026-10-11 → AI20261011- : the journal-number prefix of a batch."""
    return "AI" + re.sub(r"\D", "", tag) + "-"


# Read-only resources besides journals. Each path is a separate setting and is
# empty until confirmed against the live tenant: a list call on an unset path
# raises DaftraNotConfigured instead of guessing.
RESOURCES = ("accounts", "invoices", "suppliers", "expenses")


class MockDaftraAdapter:
    """In-memory fake used until credentials and verified endpoints exist."""
    def __init__(self, journals: list[dict] | None = None, *, fail_times: int = 0,
                 resources: dict[str, list[dict]] | None = None):
        self.journals = {str(j["id"]): j for j in (journals or [])}
        self.resources = {k: list((resources or {}).get(k, [])) for k in RESOURCES}
        self.fail_times = fail_times
        self.calls = 0

    def _maybe_fail(self):
        self.calls += 1
        if self.fail_times > 0:
            self.fail_times -= 1
            raise DaftraUnavailable("mock: simulated outage")

    def list_journals(self, page: int = 1) -> list[dict]:
        self._maybe_fail()
        return list(self.journals.values())

    def get_journal(self, journal_id: str) -> dict:
        self._maybe_fail()
        if journal_id not in self.journals:
            raise DaftraError(f"journal {journal_id} not found")
        return self.journals[journal_id]

    def _list(self, name: str) -> list[dict]:
        self._maybe_fail()
        return list(self.resources[name])

    def list_accounts(self, page: int = 1) -> list[dict]:
        return self._list("accounts")

    def list_invoices(self, page: int = 1) -> list[dict]:
        return self._list("invoices")

    def list_suppliers(self, page: int = 1) -> list[dict]:
        return self._list("suppliers")

    def list_expenses(self, page: int = 1) -> list[dict]:
        return self._list("expenses")

    def write_journal(self, entry: dict) -> dict:
        raise WritesDisabled("mock adapter is read-only")


@dataclass(frozen=True)
class DaftraConfig:
    base_url: str = ""          # e.g. https://<tenant>.daftra.com/<api prefix>  — verify in the docs
    journals_path: str = ""     # verify in docs: "GET All Journals"
    auth_header: str = ""       # verify in docs: Authorization page
    api_key: str = ""
    accounts_path: str = ""     # each verified against the live tenant before use
    invoices_path: str = ""
    suppliers_path: str = ""
    expenses_path: str = ""
    writes_enabled: bool = False
    auth_via_proxy: bool = False   # the key is injected by an egress proxy, so none is held here
    timeout: float = 20.0
    max_attempts: int = 4

    @classmethod
    def from_settings(cls, st) -> "DaftraConfig":
        return cls(base_url=st.daftra_base_url, journals_path=st.daftra_journals_path,
                   auth_header=st.daftra_auth_header, api_key=st.daftra_api_key,
                   accounts_path=st.daftra_accounts_path, invoices_path=st.daftra_invoices_path,
                   suppliers_path=st.daftra_suppliers_path, expenses_path=st.daftra_expenses_path,
                   writes_enabled=st.daftra_writes_enabled,
                   auth_via_proxy=getattr(st, "daftra_auth_via_proxy", False))

    def missing(self) -> list[str]:
        return [n for n, v in (("DAFTRA_BASE_URL", self.base_url), ("DAFTRA_JOURNALS_PATH", self.journals_path),
                               ("DAFTRA_AUTH_HEADER", self.auth_header),
                               ("DAFTRA_API_KEY", self.api_key or self.auth_via_proxy)) if not v]


class HttpDaftraAdapter:
    def __init__(self, cfg: DaftraConfig, transport: httpx.BaseTransport | None = None,
                 sleep=time.sleep):
        missing = cfg.missing()
        if missing:
            raise DaftraNotConfigured("missing settings: " + ", ".join(missing))
        self.cfg, self._sleep = cfg, sleep
        headers = {"Accept": "application/json"}
        if cfg.api_key:
            headers[cfg.auth_header] = cfg.api_key
        self.http = httpx.Client(base_url=cfg.base_url.rstrip("/"), timeout=cfg.timeout, transport=transport,
                                 headers=headers)

    def _get(self, path: str, params: dict | None = None) -> dict | list:
        delay = 1.0
        for attempt in range(1, self.cfg.max_attempts + 1):
            try:
                r = self.http.get(path, params=params)
            except httpx.TransportError as exc:
                err: DaftraError = DaftraUnavailable(f"network: {exc}")
            else:
                if r.status_code == 429 or r.status_code >= 500:
                    err = DaftraUnavailable(f"HTTP {r.status_code}")
                elif r.status_code >= 400:
                    raise DaftraError(f"HTTP {r.status_code}: {r.text[:300]}")   # not retryable
                else:
                    try:
                        return r.json()
                    except ValueError as exc:
                        raise DaftraError("response is not JSON") from exc
            if attempt == self.cfg.max_attempts:
                raise err
            self._sleep(delay)
            delay = min(delay * 2, 16.0)
        raise AssertionError("unreachable")

    def list_journals(self, page: int = 1) -> list[dict]:
        data = self._get(self.cfg.journals_path, {"page": page})
        # The list envelope shape is unverified; accept a bare list or {"data": [...]}.
        if isinstance(data, dict):
            data = data.get("data", [])
        if not isinstance(data, list):
            raise DaftraError("unexpected journals payload shape")
        return data

    def _list(self, name: str, page: int) -> list[dict]:
        path = getattr(self.cfg, f"{name}_path")
        if not path:
            raise DaftraNotConfigured(f"missing setting: DAFTRA_{name.upper()}_PATH")
        data = self._get(path, {"page": page})
        # Same unverified envelope as journals: a bare list or {"data": [...]}.
        if isinstance(data, dict):
            data = data.get("data", [])
        if not isinstance(data, list):
            raise DaftraError(f"unexpected {name} payload shape")
        return data

    def list_accounts(self, page: int = 1) -> list[dict]:
        return self._list("accounts", page)

    def list_invoices(self, page: int = 1) -> list[dict]:
        return self._list("invoices", page)

    def list_suppliers(self, page: int = 1) -> list[dict]:
        return self._list("suppliers", page)

    def list_expenses(self, page: int = 1) -> list[dict]:
        return self._list("expenses", page)

    def get_journal(self, journal_id: str) -> dict:
        data = self._get(f"{self.cfg.journals_path.rstrip('/')}/{journal_id}")
        if not isinstance(data, dict):
            raise DaftraError("unexpected journal payload shape")
        return data

    # ------------------------------------------------------------------ writes
    def _guard(self) -> None:
        if not self.cfg.writes_enabled:
            raise WritesDisabled("Daftra writes are disabled (DAFTRA_WRITES_ENABLED=false)")

    def _send(self, method: str, path: str, body: dict | None = None) -> dict:
        """One attempt only. A 4xx/5xx or a network error raises; the caller decides what to re-read."""
        try:
            r = self.http.request(method, path, json=body,
                                  headers={"Content-Type": "application/json"} if body is not None else None)
        except httpx.TransportError as exc:
            raise DaftraUnavailable(f"network during {method} {path}: {exc} — re-read before retrying") from exc
        try:
            data = r.json()
        except ValueError:
            data = {"raw": r.text[:300]}
        if r.status_code >= 400:
            raise DaftraError(f"HTTP {r.status_code} on {method} {path}: {str(data)[:400]}")
        return data

    def create_account(self, *, journal_cat_id: int, code: str, name: str, debit_nature: bool) -> int:
        self._guard()
        if not code.isdigit():
            raise WriteRefused("account code must be digits only")
        data = self._send("POST", self.cfg.accounts_path, {"JournalAccount": {
            "journal_cat_id": int(journal_cat_id), "code": code, "name": name, "type": 1 if debit_nature else 0}})
        return int(data["id"])

    def post_journal(self, *, date: str, description: str, number: str, tag: str,
                     lines: list[tuple[int, Decimal, Decimal, str]], draft: bool = False) -> int:
        """lines: (journal_account_id, debit, credit, line description). Returns the new journal id."""
        self._guard()
        if not tag or not description.startswith(f"[{tag}]"):
            raise WriteRefused(f"journal description must start with [{tag}]")
        if not number.startswith(tag_prefix(tag)):
            raise WriteRefused(f"journal number must start with {tag_prefix(tag)}")
        if len(lines) < 2:
            raise WriteRefused("a journal needs at least two lines")
        dr = sum((Decimal(l[1]) for l in lines), Decimal("0"))
        cr = sum((Decimal(l[2]) for l in lines), Decimal("0"))
        if dr != cr or dr <= 0 or any(Decimal(l[1]) < 0 or Decimal(l[2]) < 0 for l in lines):
            raise WriteRefused(f"unbalanced or non-positive journal: debit {dr}, credit {cr}")
        data = self._send("POST", self.cfg.journals_path, {
            "Journal": {"date": date, "description": description, "number": number,
                        "currency_code": "SAR", "draft": 1 if draft else 0},
            "JournalTransaction": [{"journal_account_id": int(a), "currency_debit": float(d),
                                    "currency_credit": float(c), "description": t} for a, d, c, t in lines]})
        return int(data["id"])

    def delete_journal(self, journal_id: str, *, tag: str) -> None:
        """Rollback of a tagged batch only: the journal is re-read and must carry the tag."""
        self._guard()
        j = self.get_journal(str(journal_id))
        desc = (j.get("data", j).get("Journal", {}) or {}).get("description", "") if isinstance(j, dict) else ""
        if not str(desc).startswith(f"[{tag}]"):
            raise WriteRefused(f"journal {journal_id} does not carry [{tag}] — not deleting it")
        self._send("DELETE", f"{self.cfg.journals_path.rsplit('.', 1)[0]}/{journal_id}.json")

    def write_journal(self, entry: dict) -> dict:
        """An agent-built entry (internal account codes). Codes are translated through chart_map —
        internal 5201 is marketing, Daftra 5201 is rent — and an unmapped code refuses the entry."""
        self._guard()
        from .chart_map import to_daftra
        codes = [to_daftra(line["account_code"]) for line in entry.get("lines", [])]
        raise NotImplementedError("agent entries are posted as an owner-approved tagged batch "
                                  f"(see docs/DAFTRA.md); resolved Daftra codes: {codes}")
