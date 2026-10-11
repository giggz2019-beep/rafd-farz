"""Check app/daftra/chart_map.py against a snapshot pulled by scripts/daftra_pull.py.

    python scripts/daftra_chart_check.py SNAPSHOT_DIR

Reads SNAPSHOT_DIR/accounts.json only — no network. Exits 1 if any mapped code is wrong.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.ledger import ChartOfAccounts  # noqa: E402
from app.daftra.chart_map import DAFTRA_CODES, check_mapping, unmapped  # noqa: E402


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: python scripts/daftra_chart_check.py SNAPSHOT_DIR", file=sys.stderr)
        return 2
    rows = json.loads((Path(sys.argv[1]) / "accounts.json").read_text())
    accounts = [r.get("JournalAccount", r) for r in rows]
    problems = check_mapping(ChartOfAccounts(), accounts)
    mapped = {c: t for c, t in DAFTRA_CODES.items() if t}
    print(json.dumps({"mapped": mapped, "unmapped": unmapped(), "problems": problems}, ensure_ascii=False, indent=1))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
