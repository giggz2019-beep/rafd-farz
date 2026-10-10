# Architecture

## Principles

1. **The model decides categories; code decides amounts.** Claude picks an account, a recognition
   method, or writes an opinion — always into a strict JSON schema. Every amount that reaches the
   ledger is computed by deterministic `Decimal` code in `app/core/`.
2. **Agents propose; the gateway disposes.** Agents have no direct access to the database, the ledger
   or Daftra. Every effect is a named tool call through `ToolGateway`, which checks RBAC, idempotency
   and owner approval, and audits the outcome — including denials.
3. **The owner is the only approver.** `Op.APPROVE` belongs to the `owner` role alone (asserted at
   import time). Approvals are bound to the exact payload by SHA-256 and are single-use.
4. **Nothing is destroyed.** Source documents are content-addressed and insert-only; journal entries
   are insert-only and corrected by reversal; the audit log is hash-chained and, on PostgreSQL, the
   application role has no UPDATE/DELETE/TRUNCATE on it.
5. **Fail closed.** No LLM → the job fails and retries instead of guessing. Unverified Daftra settings →
   the HTTP adapter refuses to start. Daftra writes → disabled, even with an approval.

## Components

```
                 ┌──────────────── VPS (docker compose) ─────────────────┐
 n8n / Telegram ─┤ api (FastAPI)  ── service token ──► /api/documents     │
 owner browser ──┤   dashboard    ── owner token ────► /api/approvals     │
                 │      │ enqueue                                         │
                 │      ▼                                                 │
                 │   redis (queue) ──► worker (24/7 agent runtime) ──────┼──► Claude API
                 │                         │                              │    (own API key)
                 │                         ▼                              │
                 │                   ToolGateway ── RBAC ─ idempotency ─ approvals ─ audit
                 │                         │                              │
                 │                   postgres: records, audit_log         │──► Daftra (read-only,
                 └────────────────────────────────────────────────────────┘    when configured)
```

| Layer | Files | Notes |
|---|---|---|
| Domain rules | `app/core/` | money, VAT, ledger, invoices + duplicates, payroll/GOSI, reconciliation, reports — no I/O, no LLM |
| Security | `app/security/` | permissions matrix, approvals, hash-chained audit log, Fernet secrets |
| Tools | `app/orchestration/services.py` | one function per tool, each bound to one `Op` |
| Gateway | `app/orchestration/gateway.py` | RBAC → idempotency → approval → execute → audit |
| Agents | `app/agents/` | 10 agents, prompts, typed I/O |
| Workflows | `app/orchestration/workflows.py` | checkpointed, resumable jobs |
| LLM | `app/llm/client.py` | Claude structured outputs; `ScriptedLLM` for tests |
| Daftra | `app/daftra/adapter.py` | mock + read-only HTTP adapter |
| Runtime | `app/worker.py`, `app/api/` | 24/7 worker, API, dashboard |

## Segregation of duties

Every effect has a preparer and a different executor, and the owner approves in between:

| Step | Who prepares / records | Who executes (after owner approval) |
|---|---|---|
| New vendor | Accounts Payable requests | owner approves → added to the approved list |
| Purchase order (above 1,000 SAR) | Accounts Payable raises | owner approves |
| Goods / service received | Accounts Payable records the receipt | — |
| Journal entry | Expense / Revenue Accountant prepares, Internal Audit reviews | Accounting Manager posts |
| Vendor payment | Accounts Payable raises a payment request | Accounting Manager executes |
| Payroll | Payroll Accountant computes | Accounting Manager pays |
| VAT return | VAT Accountant prepares | Accounting Manager releases the filing package; the owner files |
| Bank details | Bank Reconciliation only reports | Accounting Manager requests the change |

`INCOMPATIBLE` in `app/security/permissions.py` lists the operation pairs no single role may hold; the
module refuses to load if the matrix breaks one.

## Purchase-invoice workflow

| Step | Agent | Tool | Result |
|---|---|---|---|
| vat | VAT Accountant | `vat.validate_invoice` | VAT issues (error / warning / info) |
| classify | Expense Accountant | Claude → `ExpenseDecision`, then `expense.propose_entry` | account + balanced entry |
| audit | Internal Audit | `documents.verify`, `invoices.check_duplicate`, `purchasing.check_controls` (approved vendor, PO, receipt), `audit.review_entry` (+ optional Claude opinion) | blockers / warnings |
| register | Accounts Payable | `payables.register` | payable + duplicate index (skipped when blocked) |
| finalize | Accounting Manager | fixed policy, then `ledger.post_staging` | posted / held for owner / rejected |

Sales invoices follow the same shape with the Revenue Accountant and Accounts Receivable. A
customer advance is recognised as **deferred revenue (2301)** until the service is delivered.

### Manager policy (deterministic; the model never overrides it)

- exact duplicate → **reject**
- any blocker (missing document, VAT error, unbalanced entry, unknown account) → **hold for owner**
- possible duplicate, audit opinion `hold`/`reject`, low classification confidence, or "needs review" → **hold for owner**
  (a confident preparer contradicted by audit is recorded as `conflict: true`)
- preparer is the manager itself → **hold** (segregation of duties)
- otherwise → **post** to the staging ledger

A held entry becomes an approval request; the owner approves it on the dashboard and the manager
posts it, consuming that approval. If the hold had skipped registering the payable/receivable, it is
registered then, so the invoice can be paid (once its vendor is approved) and a copy is caught as a duplicate.

## Recovery

Each step's result is stored as soon as it finishes. A restarted job skips finished steps; a step that
crashed half-way replays its finished tool calls from the idempotency store (so Claude is not paid twice
and nothing is posted twice). Approval-gated effects take a claim before running: if a crash leaves a
claim without a result, the call is **blocked for manual verification** rather than retried — a payment
is never repeated blindly. On start-up the worker re-queues jobs left `running` or failed for a
retryable reason (rate limit, network, Daftra outage), up to 5 attempts.

## What is deliberately not automated

Bank transfers, payroll payments, ZATCA filing, bank-detail changes and Daftra writes produce an
**instruction** after approval; a person carries it out in the bank portal / ZATCA portal / Daftra.
Automating any of them is a separate change that must add its own integration tests.
