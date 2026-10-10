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

Writes are not implemented. ``write_journal`` exists only to show where the
approval gate sits; it raises WritesDisabled unless DAFTRA_WRITES_ENABLED is
true, and even then it raises NotImplementedError until the write endpoint has
been verified against the official documentation.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
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


class DaftraAdapter(Protocol):
    def list_journals(self, page: int = 1) -> list[dict]: ...
    def get_journal(self, journal_id: str) -> dict: ...
    def write_journal(self, entry: dict) -> dict: ...


class MockDaftraAdapter:
    """In-memory fake used until credentials and verified endpoints exist."""
    def __init__(self, journals: list[dict] | None = None, *, fail_times: int = 0):
        self.journals = {str(j["id"]): j for j in (journals or [])}
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

    def write_journal(self, entry: dict) -> dict:
        raise WritesDisabled("mock adapter is read-only")


@dataclass(frozen=True)
class DaftraConfig:
    base_url: str = ""          # e.g. https://<tenant>.daftra.com/<api prefix>  — verify in the docs
    journals_path: str = ""     # verify in docs: "GET All Journals"
    auth_header: str = ""       # verify in docs: Authorization page
    api_key: str = ""
    writes_enabled: bool = False
    timeout: float = 20.0
    max_attempts: int = 4

    def missing(self) -> list[str]:
        return [n for n, v in (("DAFTRA_BASE_URL", self.base_url), ("DAFTRA_JOURNALS_PATH", self.journals_path),
                               ("DAFTRA_AUTH_HEADER", self.auth_header), ("DAFTRA_API_KEY", self.api_key)) if not v]


class HttpDaftraAdapter:
    def __init__(self, cfg: DaftraConfig, transport: httpx.BaseTransport | None = None,
                 sleep=time.sleep):
        missing = cfg.missing()
        if missing:
            raise DaftraNotConfigured("missing settings: " + ", ".join(missing))
        self.cfg, self._sleep = cfg, sleep
        self.http = httpx.Client(base_url=cfg.base_url.rstrip("/"), timeout=cfg.timeout, transport=transport,
                                 headers={cfg.auth_header: cfg.api_key, "Accept": "application/json"})

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

    def get_journal(self, journal_id: str) -> dict:
        data = self._get(f"{self.cfg.journals_path.rstrip('/')}/{journal_id}")
        if not isinstance(data, dict):
            raise DaftraError("unexpected journal payload shape")
        return data

    def write_journal(self, entry: dict) -> dict:
        if not self.cfg.writes_enabled:
            raise WritesDisabled("Daftra writes are disabled (DAFTRA_WRITES_ENABLED=false)")
        raise NotImplementedError("verify the Add New Journal request body against docs.daftara.dev first")
