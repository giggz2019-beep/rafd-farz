# RAFD Digital — AI Accounting Department

A multi-agent accounting system for شركة رفد الرقمية: ten specialised agents that classify, validate,
audit and post transactions, with the owner as the only approver of anything that moves money,
files taxes or changes records.

> **Status: development build — not production-ready.** All automated tests pass (142 on 2026-10-11; the 7
> PostgreSQL tests passed before the purchase-controls change and were not re-run after it), but the live-model evaluation has not been run, the Daftra connection has only been
> read (GET) from a tenant that holds no transactions yet ([docs/DAFTRA.md](docs/DAFTRA.md)), and the Docker stack has not been started on a server. See
> [docs/SECURITY.md](docs/SECURITY.md#known-gaps--must-be-closed-before-calling-this-production-ready).

## What it does

- Purchase and sales invoices → VAT check → classification (Claude) → deterministic journal entry →
  independent audit → manager policy → posted, held for the owner, or rejected.
- Catches exact and near-duplicate invoices, wrong VAT, VAT charged by unregistered sellers or by the
  (unregistered) company, missing or altered documents, unbalanced entries.
- Payroll with GOSI, bank reconciliation, AR aging, AP payment requests, VAT return preparation,
  financial statements with a commentary that cannot invent numbers.
- Segregation of duties: whoever prepares never executes. Accounts Payable requests a payment, the
  Accounting Manager executes it, the owner approves in between.
- Purchase controls: approved vendors only; above 1,000 SAR an owner-approved purchase order with a
  recorded receipt (three-way match), unless the vendor's standing limit covers it. The receipt is
  recorded by the Expense Accountant, never by Accounts Payable, and purchases split under the
  threshold (same vendor, no PO, within 7 days) are added up and held.
- Account codes are mapped to Daftra's chart explicitly (`app/daftra/chart_map.py`); the same digits
  mean different accounts in the two charts.
- Every action — including refused ones — goes to a hash-chained audit log.

## Layout

```
app/core/            deterministic accounting rules (no I/O, no LLM)
app/security/        permissions, approvals, audit log, encrypted secrets
app/orchestration/   tool catalogue, ToolGateway, resumable workflows
app/agents/          the 10 agents and their system prompts
app/llm/             Claude client (structured outputs) + scripted stand-in
app/daftra/          Daftra adapter (mock + read-only HTTP)
app/api/             FastAPI + owner approval dashboard
app/worker.py        24/7 agent runtime (Claude API)
app/evals/ evals/    evaluation harness and cases
tests/               126 tests (7 need PostgreSQL)
.claude/agents/      10 Claude Code development subagents (review aids, not the runtime)
deploy/ docker-compose.yml Dockerfile .env.example
```

## Docs

- [Architecture](docs/ARCHITECTURE.md) · [The ten agents](docs/AGENTS.md) · [Security](docs/SECURITY.md)
- [Daftra integration](docs/DAFTRA.md) · [Installation](docs/INSTALL.md)

## Two kinds of "agents"

- **Runtime agents** (`app/agents/`) run unattended in `app/worker.py` and call the **Claude API** with
  their own `ANTHROPIC_API_KEY`. API usage is billed separately from any Claude / Claude Code plan.
- **Claude Code subagents** (`.claude/agents/`) are development helpers that review changes to each
  runtime agent. They never run in production.
