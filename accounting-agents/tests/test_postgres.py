"""PostgreSQL integration: least-privilege grants and the workflow on a real server.

Skipped unless both URLs are set, e.g.
  TEST_PG_ADMIN_URL=postgresql+psycopg://rafd_admin:pw@localhost:54329/rafd
  TEST_PG_APP_URL=postgresql+psycopg://rafd_app:pw@localhost:54329/rafd
"""
import os
import random

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import ProgrammingError

from app.config import Settings
from app.llm.client import ScriptedLLM
from app.orchestration.services import build_services
from app.orchestration.workflows import Agents, JobRunner
from app.storage.store import Store

from .conftest import expense_llm, make_purchase

ADMIN, APP = os.environ.get("TEST_PG_ADMIN_URL"), os.environ.get("TEST_PG_APP_URL")
pytestmark = pytest.mark.skipif(not (ADMIN and APP), reason="no PostgreSQL configured")


@pytest.fixture(scope="module")
def migrated():
    from app.storage import migrate
    os.environ["DATABASE_ADMIN_URL"] = ADMIN
    os.environ["APP_DB_ROLE"] = APP.split("//")[1].split(":")[0]
    eng = create_engine(ADMIN)
    with eng.begin() as cx:
        cx.execute(text("DROP TABLE IF EXISTS records, audit_log"))
    migrate.main()
    return eng


def test_workflow_runs_as_the_app_role(migrated):
    services = build_services(Settings(database_url=APP), store=Store(APP))
    rng = random.Random(7)
    invs = [make_purchase(i, rng, services.documents) for i in range(20)]
    runner = JobRunner(services, Agents.build(services, ScriptedLLM({"ExpenseDecision": [expense_llm(a) for _, a in invs]})))
    runner.a.audit.llm = None
    assert {runner.process_purchase_invoice(f"pg-{i}", inv)["status"] for i, (inv, _) in enumerate(invs)} == {"posted"}
    dr, cr = services.ledger.trial_balance()
    assert dr == cr and len(services.ledger.entries) == 20
    assert services.audit.verify().ok


@pytest.mark.parametrize("sql", [
    "UPDATE audit_log SET outcome = 'x'",
    "DELETE FROM audit_log",
    "TRUNCATE audit_log",
    "DELETE FROM records",
    "CREATE TABLE sneaky (id int)",
    "DROP TABLE records",
])
def test_app_role_cannot_tamper(migrated, sql):
    eng = create_engine(APP)
    with pytest.raises(ProgrammingError, match="permission denied|must be owner"):
        with eng.begin() as cx:
            cx.execute(text(sql))
