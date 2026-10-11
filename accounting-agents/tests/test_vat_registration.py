"""The company is not VAT-registered; the VAT agent warns the owner as rolling 12-month taxable
sales approach the voluntary (187,500 SAR) and mandatory (375,000 SAR) registration thresholds."""
import hashlib
from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.api.main import create_app
from app.api.queue import MemoryQueue
from app.config import Settings
from app.core.invoices import Direction, Invoice, InvoiceLine
from app.core.serde import invoice_to_dict
from app.core.vat import VatCategory, rolling_12m_taxable, threshold_alert
from app.llm.client import ScriptedLLM
from app.orchestration.services import build_services

D = Decimal


def sale(amount, on, number="S-1", category=VatCategory.STANDARD, docs=None):
    doc = docs.add(f"{number}-{amount}-{on}".encode(), f"{number}.pdf", "sales_invoice").doc_id if docs else None
    return Invoice(Direction.SALES, number, on, "Customer Co",
                   (InvoiceLine("monitoring", D(1), D(amount), category, "0"),), document_id=doc)


def test_company_is_not_vat_registered_by_default():
    s = Settings()
    assert s.company_vat_registered is False and s.vat_threshold_warn_pct == D("80")


@pytest.mark.parametrize("total,level", [
    ("149999.99", None),
    ("150000.00", "approaching_voluntary"),        # 80% of 187,500
    ("187500.00", "approaching_voluntary"),        # at the threshold is not over it
    ("187500.01", "voluntary"),
    ("299999.99", "voluntary"),
    ("300000.00", "approaching_mandatory"),        # 80% of 375,000
    ("375000.00", "approaching_mandatory"),
    ("375000.01", "mandatory"),
])
def test_threshold_levels(total, level):
    a = threshold_alert(D(total), warn_ratio=D("0.80"))
    assert (a.level if a else None) == level
    if a:
        assert a.threshold == (D("375000.00") if "mandatory" in level else D("187500.00"))


def test_rolling_window_is_the_12_months_ending_on_the_day():
    as_of = date(2026, 10, 11)
    sales = [sale("100", date(2025, 10, 11), "old"),           # exactly a year before: outside
             sale("200", date(2025, 10, 12), "in-1"),
             sale("300", as_of, "in-2"),
             sale("400", date(2026, 10, 12), "future"),         # after as_of: outside
             sale("500", date(2026, 5, 1), "exempt", VatCategory.EXEMPT),
             sale("600", date(2026, 5, 1), "zero", VatCategory.ZERO_RATED)]
    assert rolling_12m_taxable(sales, as_of) == D("1100.00")   # 200 + 300 + 600


def test_leap_day_window():
    assert rolling_12m_taxable([sale("10", date(2027, 3, 1))], date(2028, 2, 29)) == D("10.00")


def _run_sale(runner_factory, services, amount, on, n):
    runner, _ = runner_factory({"RevenueDecision": [{"revenue_account": "4102", "recognition": "immediate",
                                                      "rationale": "t", "needs_human_review": False}]})
    inv = invoice_to_dict(sale(amount, on, n, docs=services.documents))
    return runner.process_sales_invoice(n, inv, {"service_delivered": True})


def _alerts(services):
    return [r for r in services.audit.rows() if r["action"] == "vat.threshold_alert"]


def test_each_registered_sale_rechecks_and_alerts_the_owner_once_per_level(services, runner_factory):
    r = _run_sale(runner_factory, services, "100000", date(2026, 3, 1), "S-1")
    assert r["status"] == "posted" and r["done"]["vat_threshold"]["alert"] is None and not _alerts(services)

    r = _run_sale(runner_factory, services, "60000", date(2026, 4, 1), "S-2")   # 160,000
    assert r["done"]["vat_threshold"]["alert"]["level"] == "approaching_voluntary"
    assert [a["target"] for a in _alerts(services)] == ["approaching_voluntary"]

    _run_sale(runner_factory, services, "1000", date(2026, 4, 2), "S-3")         # same level: no new entry
    assert len(_alerts(services)) == 1

    r = _run_sale(runner_factory, services, "30000", date(2026, 5, 1), "S-4")   # 191,000
    assert r["done"]["vat_threshold"]["alert"]["level"] == "voluntary"
    assert [a["target"] for a in _alerts(services)] == ["approaching_voluntary", "voluntary"]


def test_a_blocked_sale_does_not_count(services, runner_factory):
    runner, _ = runner_factory({"RevenueDecision": [{"revenue_account": "4102", "recognition": "immediate",
                                                      "rationale": "t", "needs_human_review": False}]})
    inv = invoice_to_dict(Invoice(Direction.SALES, "V-1", date(2026, 3, 1), "Customer Co",
                                  (InvoiceLine("x", D(1), D("200000"), VatCategory.STANDARD, "30000"),),
                                  document_id=services.documents.add(b"v", "v.pdf", "sales_invoice").doc_id))
    r = runner.process_sales_invoice("v", inv, {"service_delivered": True})
    assert r["status"] == "held_for_owner" and r["done"]["vat_threshold"] == {"skipped": True}
    assert not _alerts(services)


def test_a_registered_company_is_not_warned(runner_factory):
    services = build_services(Settings(company_vat_registered=True))
    from app.agents.roster import VatAccountantAgent
    services.kv.add("invoice_sales", "k", invoice_to_dict(sale("400000", date(2026, 3, 1))))
    out = VatAccountantAgent(services).registration_check("2026-10-11", key="r")
    assert out["rolling_12m_taxable"] == "400000.00" and out["alert"] is None


def test_owner_endpoint_reports_the_alert_and_needs_the_owner_token():
    owner = "owner-token"
    settings = Settings(owner_token_sha256=hashlib.sha256(owner.encode()).hexdigest())
    services = build_services(settings)
    services.kv.add("invoice_sales", "k", invoice_to_dict(sale("380000", date.today())))
    c = TestClient(create_app(settings, services=services, llm=ScriptedLLM({}), queue=MemoryQueue()))
    assert c.get("/api/vat/registration").status_code == 401
    body = c.get("/api/vat/registration", headers={"Authorization": f"Bearer {owner}"}).json()
    assert body["vat_registered"] is False and body["alert"]["level"] == "mandatory"
