# Installation

## 1. Local development (no Docker)

```bash
cd accounting-agents
python3.12 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
python -m pytest            # 119 pass, 7 PostgreSQL tests skip
python -m app.evals.run     # offline harness check, free
```

Optional PostgreSQL tests (needs a local server with an admin and an app role, see `deploy/postgres-init.sh`):

```bash
TEST_PG_ADMIN_URL=postgresql+psycopg://rafd_admin:...@127.0.0.1:5432/rafd \
TEST_PG_APP_URL=postgresql+psycopg://rafd_app:...@127.0.0.1:5432/rafd \
python -m pytest
```

## 2. Linux VPS (Ubuntu 24.04, 2 vCPU / 4 GB is enough)

1. **Server basics**
   ```bash
   sudo apt update && sudo apt -y upgrade
   sudo apt -y install docker.io docker-compose-v2 ufw
   sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable
   ```
2. **DNS**: point an A record (e.g. `accounting.rafd-digital.com`) at the server.
3. **Code**: copy the `accounting-agents/` folder to `/opt/rafd-accounting`.
4. **Secrets**
   ```bash
   cd /opt/rafd-accounting && cp .env.example .env && chmod 600 .env
   openssl rand -hex 32   # run once each for DB_ADMIN_PASSWORD, APP_DB_PASSWORD, REDIS_PASSWORD
   OWNER=$(openssl rand -hex 32); echo "owner token (keep it): $OWNER"; printf %s "$OWNER" | sha256sum
   SVC=$(openssl rand -hex 32);   echo "service token: $SVC";          printf %s "$SVC" | sha256sum
   ```
   Put the hashes (not the tokens) in `OWNER_TOKEN_SHA256` / `SERVICE_TOKEN_SHA256`, set `DOMAIN`,
   and `ANTHROPIC_API_KEY` (from console.anthropic.com — billed per use, separate from any Claude
   subscription). Generate `SECRETS_MASTER_KEY` after the first build:
   `docker compose run --rm api python -m app.security.secrets`.
5. **Start**
   ```bash
   docker compose up -d --build
   docker compose logs migrate      # "schema ready; rafd_app has least-privilege grants"
   curl -s https://$DOMAIN/health
   ```
6. **Live evaluation before real data** (costs a few dollars):
   ```bash
   docker compose run --rm worker python -m app.evals.run --live --min-score 0.9
   ```
   Do not send real invoices until this passes.
7. **Dashboard**: open `https://$DOMAIN/` and paste the owner token.
8. **Feeding documents** (n8n / Telegram bot): `POST /api/documents` then `POST /api/jobs/purchase-invoice`
   with `Authorization: Bearer <service token>`.
9. **Purchasing** (service token; each lands on the dashboard for your approval, then runs):
   - `POST /api/vendors` `{name, vat_number?, standing_limit?}` — approve every supplier once. A
     `standing_limit` lets a recurring supplier (hosting, software) invoice up to that amount without a PO.
   - `POST /api/purchase-orders` `{request_id, vendor, amount, description}` — needed above
     `PURCHASE_APPROVAL_THRESHOLD` (1,000 SAR). Put the returned `po_id` on the invoice as `purchase_order_id`.
   - `POST /api/purchase-orders/{po_id}/receipts` `{receipt_id, received_on, note}` — record delivery.
   - `POST /api/payment-requests` `{request_id, payable_key, amount}` — Accounts Payable asks; once you
     approve, the Accounting Manager records the payment instruction. Make the transfer in the bank portal.

## 3. Operations

- Verify the audit chain: `GET /api/audit/verify` (owner token) — run it daily.
- Backups: add a nightly encrypted `pg_dump` to off-site storage (not configured yet).
- Upgrades: `git pull && docker compose up -d --build` — the `migrate` service runs first.
- Run **one** worker (see SECURITY.md, known gaps).
