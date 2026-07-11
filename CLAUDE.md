# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start local dev server (port 3000) — static files only, no function proxying
node server.js
# or
npm run dev
```

There is no build step — the site is pure static HTML/CSS/JS. `npm run build` is a no-op.

`node server.js` serves static files and a stub `POST /api/demo/analyze` endpoint but does **not** proxy the serverless functions in `api/`. To test `send-otp` or `chat-khalid` locally, you need a Vercel dev setup with `RESEND_API_KEY` and `ANTHROPIC_API_KEY` in a `.env` file at the repo root.

**Git push is always blocked in auto-mode** — the user must run `git push origin main` manually in the terminal after every commit.

## Architecture

**RAFD Digital** is an AI-powered applicant screening platform targeting the Saudi market. It is a static multi-page site deployed on **Vercel**, with serverless backend functions.

### Frontend (static files at repo root)

All pages are standalone `.html` files — no framework, no bundler.

- **`style.css`** — shared stylesheet for all pages.
- **`i18n.js`** — the entire translation engine. Exports a `T` object with `ar` and `en` sub-objects, each containing every UI string keyed by dot-notation (e.g. `'nav.features'`). HTML elements use `data-i18n="key"` attributes resolved at runtime. Direction (`rtl`/`ltr`) is toggled here. Language defaults to Arabic; user choice persists in `localStorage`.

### Vercel Functions (`api/`)

Active serverless functions (Vercel format: `module.exports = async (req, res) => {}`):

| File | Purpose | Env var required |
|---|---|---|
| `api/chat-khalid.js` | Powers the "Khalid" AI chatbot using Claude Haiku | `ANTHROPIC_API_KEY` |
| `api/send-otp.js` | Sends OTP verification emails via [Resend](https://resend.com) | `RESEND_API_KEY` |
| `api/partner-auth.js` | Partner login/register/OTP/reset flows; `login` action optionally verifies a Cloudflare Turnstile token before sending the login OTP | `SUPABASE_SERVICE_KEY`, optional `TURNSTILE_SECRET_KEY` |

**Critical**: If `ANTHROPIC_API_KEY` is not set in Vercel environment variables, `chat-khalid.js` immediately returns `escalate: true`, which causes the frontend to show WhatsApp/email contact links instead of a chat response. This is the most common cause of Khalid appearing "broken."

**Cloudflare Turnstile (partner login bot protection)**: `partner-login.html` embeds Cloudflare's Turnstile widget (not a hosting migration — the site stays on Vercel) as an extra layer on the `login` action. Two optional env vars, both fail open (same fallback convention as `ANTHROPIC_API_KEY` above — missing key never blocks login):
- `TURNSTILE_SITE_KEY` — client-side, safe to expose publicly. Get it from the Cloudflare dashboard under Turnstile → Add Widget, then paste it into the `TURNSTILE_SITE_KEY` constant near the top of the `<script>` block in `partner-login.html` (currently `'YOUR_SITE_KEY_HERE'`). Until a real key is pasted in, the widget stays hidden and login works exactly as it does today.
- `TURNSTILE_SECRET_KEY` — server-side only, set as a Vercel environment variable for `api/partner-auth.js`. Same Cloudflare Turnstile widget setup screen provides this secret alongside the site key. If unset, `partner-auth.js` logs a console warning and skips verification entirely (no-op).

`vercel.json`'s `Content-Security-Policy` header already allowlists `https://challenges.cloudflare.com` in `script-src`, `connect-src`, and `frame-src` so the Turnstile widget/iframe isn't blocked once a real site key is configured.

The `chat-khalid.js` function keeps a 6-message rolling history per request. When the model includes `[ESCALATE]` in its output, the function strips the token and signals the frontend to display escalation UI (WhatsApp + email links). The system prompt is the `SYSTEM_PROMPT` constant at the top of the file — this is what controls Khalid's personality and knowledge.

The `send-otp.js` email template uses inline CSS only — **no external CSS links** (Google Fonts links in email HTML cause delivery failures).

### Legacy Netlify Functions (`netlify/functions/`)

These files exist but are **not deployed** — they are an older version from before the Vercel migration. Do not edit these; edit `api/` instead.

### Vercel configuration (`vercel.json`)

```json
{ "buildCommand": "", "outputDirectory": ".", "installCommand": "npm install --production", "framework": null }
```

Vercel dashboard settings must match: Framework = Other, Build Command = empty, Output Directory = `.`.

### Local dev server (`server.js`)

A minimal Express server that serves all static files and provides a stub `POST /api/demo/analyze` endpoint (returns `{success:true}` after 500 ms). Only used for local development.

### Page groups

| Group | Files |
|---|---|
| Public marketing | `index.html`, `about.html`, `how-it-works.html`, `pricing.html`, `privacy.html`, `terms.html`, `partners.html` |
| Application flow | `demo-apply.html`, `apply.html`, `demo-jobs.html` |
| Partner portal | `register-partner.html`, `partner-login.html`, `partner-dashboard.html` |
| Admin / internal | `admin.html`, `dashboard.html`, `login.html`, `signup.html` |

### i18n conventions

- All new UI strings must be added to **both** `T.ar` and `T.en` in `i18n.js`.
- Keys follow page-prefix dot-notation: `nav.*`, `hero.*`, `pg.*` (pricing), `db.*` (dashboard), `rp.*` (register-partner), `apply.*`, `da.*` (demo-apply), `pl.*` (partner-login), `adm.*` (admin), `chat.*` (Khalid chatbot).
- Arabic is the primary language; English strings must match semantics exactly.
- Use `data-i18n-placeholder="key"` (not `data-i18n`) to translate `placeholder` attributes on inputs.
- For programmatic access to a translated string in JS logic, use `getT('key')` — reads from `localStorage` and falls back to Arabic.
- Pages can listen to the `rafd-lang-changed` CustomEvent on `document` (detail: `{ lang }`) to react to language switches without polling.
