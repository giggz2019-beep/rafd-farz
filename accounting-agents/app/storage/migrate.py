"""Create the schema and lock down the application role (PostgreSQL).

Run once per deploy with an admin connection:
    DATABASE_ADMIN_URL=postgresql+psycopg://admin:...@db/rafd APP_DB_ROLE=rafd_app python -m app.storage.migrate

The application role ends up with:
    records   : SELECT, INSERT, UPDATE        (no DELETE)
    audit_log : SELECT, INSERT                (no UPDATE, no DELETE, no TRUNCATE)
"""
from __future__ import annotations

import os
import re

from sqlalchemy import create_engine, text

from .store import metadata


def main() -> None:
    url = os.environ["DATABASE_ADMIN_URL"]
    role = os.environ.get("APP_DB_ROLE", "rafd_app")
    if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", role):
        raise SystemExit("APP_DB_ROLE must be a plain lowercase identifier")
    engine = create_engine(url)
    metadata.create_all(engine)
    with engine.begin() as cx:
        cx.execute(text(f"REVOKE ALL ON records, audit_log FROM {role}"))
        cx.execute(text(f"GRANT SELECT, INSERT, UPDATE ON records TO {role}"))
        cx.execute(text(f"GRANT SELECT, INSERT ON audit_log TO {role}"))
        cx.execute(text(f"GRANT USAGE, SELECT ON SEQUENCE audit_log_seq_seq TO {role}"))
    print(f"schema ready; {role} has least-privilege grants")


if __name__ == "__main__":
    main()
