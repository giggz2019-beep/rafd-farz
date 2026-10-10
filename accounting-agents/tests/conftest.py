from __future__ import annotations

import random
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

import pytest

from app.config import Settings
from app.core.invoices import Direction, Invoice, InvoiceLine
from app.core.serde import invoice_to_dict
from app.core.vat import VatCategory
from app.llm.client import ScriptedLLM
from app.orchestration.gateway import ApprovalRequired
from app.security.permissions import Role
from app.orchestration.services import build_services
from app.orchestration.workflows import Agents, JobRunner

VENDORS = [  # (name, valid TRN or None, typical expense account)
    ("Anthropic PBC", None, "5101"), ("GitHub Inc", None, "5101"), ("Netlify Inc", None, "5102"),
    ("GoDaddy", None, "5102"), ("STC", "300000000000003", "5801"), ("Snap Ads", None, "5201"),
    ("Jarir Bookstore", "310000000000003", "5801"), ("Saudi Business Center", None, "5401"),
    ("Mostaql", None, "5601"), ("Office Landlord", "302222222200003", "5501"),
]


def make_purchase(i: int, rng: random.Random, docs) -> tuple[dict, str]:
    name, trn, account = VENDORS[i % len(VENDORS)]
    n_lines = rng.randint(1, 3)
    lines = []
    for j in range(n_lines):
        qty = Decimal(rng.randint(1, 4))
        price = Decimal(rng.randint(500, 250000)) / 100
        net = (qty * price).quantize(Decimal("0.01"))
        vat = (net * Decimal("0.15")).quantize(Decimal("0.01"), ROUND_HALF_UP) if trn else Decimal("0.00")
        lines.append(InvoiceLine(f"item {j}", qty, price, VatCategory.STANDARD, vat))
    content = f"purchase-{i}-{name}-{rng.random()}".encode()
    doc = docs.add(content, f"inv{i}.pdf", "purchase_invoice")
    inv = Invoice(Direction.PURCHASE, f"INV-{1000 + i}", date(2026, 1, 1) + timedelta(days=i), name,
                  tuple(lines), seller_vat_number=trn, document_id=doc.doc_id)
    inv = Invoice(**{**inv.__dict__, "stated_total": inv.total})
    return invoice_to_dict(inv), account


@pytest.fixture
def settings():
    return Settings()


@pytest.fixture
def services(settings):
    return build_services(settings)


def expense_llm(account="5101", confidence="high", review=False):
    return {"account_code": account, "confidence": confidence, "rationale": "test", "needs_human_review": review}


def approve_opinion():
    return {"recommendation": "approve", "concerns": []}


def approve(services, call):
    """Run a gated call the way production does: it asks, the owner approves, it runs."""
    with pytest.raises(ApprovalRequired) as exc:
        call(None)
    services.approvals.approve(exc.value.request.id, Role.OWNER)
    return call(exc.value.request.id)


def approve_vendor(services, name, vat_number=None, standing_limit=None):
    from app.agents.roster import AccountsPayableAgent
    ap = AccountsPayableAgent(services)
    return approve(services, lambda aid: ap.add_vendor(name, vat_number, standing_limit,
                                                      key=f"vendor:{name}", approval_id=aid))


def approve_test_vendors(services, standing_limit="1000000"):
    """The fixture vendors are recurring suppliers with a standing limit, so no PO is needed."""
    for name, trn, _ in VENDORS:
        approve_vendor(services, name, trn, standing_limit)


@pytest.fixture
def runner_factory(services):
    def make(responses: dict | None = None, audit_responses: dict | None = None, approve_vendors: bool = True):
        if approve_vendors and not services.kv.list("vendor"):
            approve_test_vendors(services)
        llm = ScriptedLLM(responses or {})
        audit_llm = ScriptedLLM(audit_responses) if audit_responses is not None else None
        agents = Agents.build(services, llm, audit_llm=audit_llm)
        if audit_llm is None:
            agents.audit.llm = None          # deterministic audit only unless the test scripts an opinion
        return JobRunner(services, agents), llm
    return make
