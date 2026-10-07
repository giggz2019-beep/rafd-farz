# Security

## Controls and where they are tested

| Control | Implementation | Test |
|---|---|---|
| Role-based access | `PERMISSIONS` matrix; enforced in `ToolGateway.call` | `test_security.py::test_gateway_enforces_rbac…`, `test_agent_cannot_call_any_tool_outside_its_set` (×10) |
| Least-privilege toolsets | each agent declares tools ⊆ its operations; checked at construction | `test_every_agent_toolset_is_within_its_permissions` |
| Owner is the only approver | `Op.APPROVE` only on `owner`, asserted at import | `test_no_agent_can_approve` |
| Approval gates | transfers, bank-detail changes, tax filing, payroll payment, reversals, Daftra writes | `test_every_sensitive_operation_is_gated` |
| Payload-bound, single-use approvals | SHA-256 of payload; status → executed | `test_approval_cannot_be_used_for_a_different_payload`, `…single_use` |
| No automatic production writes | `DAFTRA_WRITES_ENABLED=false`; writes raise even after approval | `test_daftra_write_stays_disabled_even_after_approval` |
| Idempotency | per-tool key store; gated calls claim before executing | `test_interruption…`, `test_interrupted_gated_effect_is_not_blindly_repeated` |
| Tamper-evident audit log | hash chain; `/api/audit/verify` | `test_audit_chain_detects_tampering` |
| DB-level append-only audit log | app role: audit_log SELECT/INSERT only; records no DELETE; no CREATE | `test_postgres.py::test_app_role_cannot_tamper` (×6, real PostgreSQL 16) |
| Immutable source documents | content-addressed, insert-only, integrity-checked on read | `test_source_documents_cannot_be_modified` |
| Prompt injection | model outputs are schema-limited decisions; the model holds no tools; invoice text is labelled as data in every prompt | `test_llm_output_outside_the_schema_is_refused` |
| Hallucinated figures | analyst commentary containing numbers not in the report is withheld | `test_commentary_with_invented_numbers_is_withheld` |
| Separate API credentials | owner token vs service token, stored as SHA-256 only, constant-time compare | `test_api.py::test_tokens_are_not_interchangeable` |
| Encrypted secrets | Fernet with `SECRETS_MASTER_KEY` kept outside the DB | — (thin wrapper over `cryptography`) |
| Network isolation | db/redis on an `internal: true` network; only Caddy publishes ports | compose file |
| Container hardening | non-root user, read-only root FS, `cap_drop: ALL`, `no-new-privileges` | compose file |

## Known gaps — must be closed before calling this production-ready

1. **No live Claude evaluation has been run.** `python -m app.evals.run --live` must pass (≥ 90%) on
   the real model before the worker processes real invoices. The offline run only checks the harness.
2. **The Daftra adapter has never touched a real Daftra account.** Endpoint paths, the auth header and
   the response envelope are unverified (the docs site was unreachable from the build environment).
3. **The Docker images were not built or started** in the build environment (no Docker daemon there).
   Run the steps in INSTALL.md on a staging VPS first.
4. **Single worker.** Two workers on the same job are safe for posting (idempotent) but job bookkeeping is
   last-writer-wins; run exactly one worker until job leasing is added.
5. **Retry backoff sleeps inside the worker loop**, which delays other jobs during an outage.
6. **Dashboard token in sessionStorage**; the CSP still allows inline script. Acceptable for a single owner
   behind TLS; replace with an HttpOnly session cookie + CSRF token before adding more users.
7. **No login rate limiting / IP allow-list** on the dashboard. Tokens are 256-bit random, so guessing is
   impractical, but consider a Caddy IP allow-list.
8. **Backups**: none configured. Add encrypted `pg_dump` off-site; the audit log is only as durable as the database.
9. **GOSI rates and Saudi tax rules are configuration**, not verified per employee/registration date.
   A licensed accountant must review payroll, VAT returns and zakat before anything is filed.
