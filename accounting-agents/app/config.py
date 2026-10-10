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
    company_vat_registered: bool = False
    # A purchase above this total (SAR, incl. VAT) needs an owner-approved purchase order with a
    # recorded receipt, unless the vendor's approved standing limit covers it.
    purchase_approval_threshold: Decimal = Decimal("1000")
    daftra_base_url: str = ""
    daftra_journals_path: str = ""
    daftra_auth_header: str = ""
    daftra_api_key: str = ""
    daftra_writes_enabled: bool = False        # hard off in this version
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
            purchase_approval_threshold=Decimal(e("PURCHASE_APPROVAL_THRESHOLD", "1000")),
            daftra_base_url=e("DAFTRA_BASE_URL", ""),
            daftra_journals_path=e("DAFTRA_JOURNALS_PATH", ""),
            daftra_auth_header=e("DAFTRA_AUTH_HEADER", ""),
            daftra_api_key=e("DAFTRA_API_KEY", ""),
            daftra_writes_enabled=_bool("DAFTRA_WRITES_ENABLED", False),
            owner_token_sha256=e("OWNER_TOKEN_SHA256", ""),
            service_token_sha256=e("SERVICE_TOKEN_SHA256", ""),
            secrets_master_key=e("SECRETS_MASTER_KEY", ""),
        )
