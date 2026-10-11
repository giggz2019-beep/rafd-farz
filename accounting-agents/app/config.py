"""Runtime settings, read from the environment (see .env.example)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from decimal import Decimal

from .core.payroll import GosiRates


def _bool(name: str, default: bool) -> bool:
    v = os.environ.get(name)
    return default if v is None else v.strip().lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class Settings:
    database_url: str = "sqlite+pysqlite:///:memory:"
    redis_url: str = ""
    anthropic_api_key: str = ""
    claude_model: str = "claude-opus-5-5"
    claude_fallbacks: bool = True
    # NOT registered — the owner's decision (2026-10-11): neither mandatory nor voluntary. Keep false
    # until the company actually registers with ZATCA; the VAT agent warns as revenue nears the
    # thresholds (vat.registration_check). team.html / supabase-team.sql carry the same fact.
    company_vat_registered: bool = False
    # How close to a VAT threshold (percent) counts as "approaching" it.
    vat_threshold_warn_pct: Decimal = Decimal("80")
    # A purchase above this total (SAR, incl. VAT) needs an owner-approved purchase order with a
    # recorded receipt, unless the vendor's approved standing limit covers it.
    purchase_approval_threshold: Decimal = Decimal("1000")
    # Invoices from one vendor without a PO, issued fewer than this many days apart, are added up
    # against the threshold so a purchase cannot be split under it.
    split_purchase_window_days: int = 7
    daftra_base_url: str = ""
    # Paths and header confirmed by a 200 from rafd1.daftra.com on 2026-10-11 (docs/DAFTRA.md).
    daftra_journals_path: str = "/api2/journals.json"
    daftra_auth_header: str = "APIKEY"
    daftra_api_key: str = ""
    daftra_accounts_path: str = "/api2/journal_accounts.json"
    daftra_invoices_path: str = "/api2/invoices.json"
    daftra_suppliers_path: str = "/api2/suppliers.json"
    daftra_expenses_path: str = "/api2/expenses.json"
    daftra_writes_enabled: bool = False        # off unless the owner turns it on for a tagged batch
    daftra_auth_via_proxy: bool = False        # the API key is injected by an egress proxy
    owner_token_sha256: str = ""               # sha256 hex of the owner's dashboard token
    service_token_sha256: str = ""             # sha256 hex of the ingestion token
    secrets_master_key: str = ""
    gosi: dict = field(default_factory=dict)

    def gosi_rates(self) -> GosiRates:
        return GosiRates(**{k: Decimal(v) for k, v in self.gosi.items()}) if self.gosi else GosiRates()

    @classmethod
    def from_env(cls) -> "Settings":
        e = os.environ.get
        return cls(
            database_url=e("DATABASE_URL", cls.database_url),
            redis_url=e("REDIS_URL", ""),
            anthropic_api_key=e("ANTHROPIC_API_KEY", ""),
            claude_model=e("CLAUDE_MODEL", cls.claude_model),
            claude_fallbacks=_bool("CLAUDE_FALLBACKS", True),
            company_vat_registered=_bool("COMPANY_VAT_REGISTERED", False),
            vat_threshold_warn_pct=Decimal(e("VAT_THRESHOLD_WARN_PCT", "80")),
            purchase_approval_threshold=Decimal(e("PURCHASE_APPROVAL_THRESHOLD", "1000")),
            split_purchase_window_days=int(e("SPLIT_PURCHASE_WINDOW_DAYS", "7")),
            daftra_base_url=e("DAFTRA_BASE_URL", ""),
            daftra_journals_path=e("DAFTRA_JOURNALS_PATH", cls.daftra_journals_path),
            daftra_auth_header=e("DAFTRA_AUTH_HEADER", cls.daftra_auth_header),
            daftra_api_key=e("DAFTRA_API_KEY", ""),
            daftra_accounts_path=e("DAFTRA_ACCOUNTS_PATH", cls.daftra_accounts_path),
            daftra_invoices_path=e("DAFTRA_INVOICES_PATH", cls.daftra_invoices_path),
            daftra_suppliers_path=e("DAFTRA_SUPPLIERS_PATH", cls.daftra_suppliers_path),
            daftra_expenses_path=e("DAFTRA_EXPENSES_PATH", cls.daftra_expenses_path),
            daftra_writes_enabled=_bool("DAFTRA_WRITES_ENABLED", False),
            daftra_auth_via_proxy=_bool("DAFTRA_AUTH_VIA_PROXY", False),
            owner_token_sha256=e("OWNER_TOKEN_SHA256", ""),
            service_token_sha256=e("SERVICE_TOKEN_SHA256", ""),
            secrets_master_key=e("SECRETS_MASTER_KEY", ""),
        )
