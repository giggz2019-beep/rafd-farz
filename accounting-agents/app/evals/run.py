"""Evaluation harness for the LLM-backed agent decisions.

Cases live in evals/cases/<agent>.jsonl, one JSON object per line:
    {"id": "...", "input": {...}, "expect": {"field": value | [allowed values]}}

Modes:
  python -m app.evals.run                 offline: validates every case against the
                                          schemas with an oracle model (checks the harness,
                                          not the model; free)
  python -m app.evals.run --live          calls the Claude API for every case and scores
                                          the real model (COSTS MONEY — needs ANTHROPIC_API_KEY)
  python -m app.evals.run --live --agent expense_accountant --min-score 0.9

Exit code is non-zero when any agent scores below --min-score, so this can gate a deploy.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from ..agents.roster import AuditOpinion, ExpenseDecision, RevenueDecision
from ..llm.client import LLM, ClaudeLLM, LLMError, ScriptedLLM

CASES = Path(__file__).resolve().parents[2] / "evals" / "cases"
PROMPTS = Path(__file__).resolve().parents[1] / "agents" / "prompts"

SUITES = {
    "expense_accountant": (ExpenseDecision, "medium"),
    "revenue_accountant": (RevenueDecision, "medium"),
    "internal_audit": (AuditOpinion, "high"),
}


def load(agent: str) -> list[dict]:
    path = CASES / f"{agent}.jsonl"
    return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]


def matches(expect: dict, got: dict) -> list[str]:
    misses = []
    for k, want in expect.items():
        allowed = want if isinstance(want, list) else [want]
        if got.get(k) not in allowed:
            misses.append(f"{k}: got {got.get(k)!r}, want {allowed}")
    return misses


def oracle_for(schema, case: dict) -> dict:
    """Builds a schema-valid answer from the expectations (offline harness check)."""
    base = {"ExpenseDecision": {"account_code": "5801", "rationale": "oracle", "confidence": "high",
                                "needs_human_review": False},
            "RevenueDecision": {"revenue_account": "4101", "recognition": "immediate", "rationale": "oracle",
                                "needs_human_review": False},
            "AuditOpinion": {"concerns": []}}[schema.__name__]
    for k, v in case["expect"].items():
        base[k] = v[0] if isinstance(v, list) else v
    return base


def run_suite(agent: str, llm_factory) -> tuple[float, list[dict]]:
    schema, effort = SUITES[agent]
    system = (PROMPTS / f"{agent}.md").read_text(encoding="utf-8")
    results = []
    for case in load(agent):
        llm: LLM = llm_factory(schema, case)
        try:
            out = llm.structured(system=system, user=json.dumps(case["input"], ensure_ascii=False),
                                 schema=schema, effort=effort).model_dump()
            misses = matches(case["expect"], out)
        except LLMError as exc:
            out, misses = None, [f"error: {exc}"]
        results.append({"id": case["id"], "pass": not misses, "misses": misses, "output": out})
    score = sum(r["pass"] for r in results) / max(len(results), 1)
    return score, results


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", action="store_true", help="call the Claude API (costs money)")
    ap.add_argument("--agent", choices=sorted(SUITES), action="append")
    ap.add_argument("--min-score", type=float, default=0.9)
    args = ap.parse_args(argv)

    if args.live:
        key = os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            print("ANTHROPIC_API_KEY is required for --live", file=sys.stderr)
            return 2
        live = ClaudeLLM(key, os.environ.get("CLAUDE_MODEL", "claude-opus-5-5"))
        factory = lambda schema, case: live
    else:
        factory = lambda schema, case: ScriptedLLM({schema.__name__: oracle_for(schema, case)})

    failed = False
    for agent in args.agent or sorted(SUITES):
        score, results = run_suite(agent, factory)
        print(f"{agent:22s} {score:6.1%}  ({sum(r['pass'] for r in results)}/{len(results)})")
        for r in results:
            if not r["pass"]:
                print(f"   ✗ {r['id']}: {'; '.join(r['misses'])}")
        failed |= score < args.min_score
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
