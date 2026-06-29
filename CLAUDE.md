# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start local dev server (port 3000) — static files only, no function proxying
node server.js
# or
npm run dev

# Test Netlify functions locally (requires Netlify CLI: npm i -g netlify-cli)
netlify dev
```

There is no build step — the site is pure static HTML/CSS/JS. `npm run build` is a no-op.

`node server.js` serves static files and a stub `/api/demo/analyze` endpoint but does **not** proxy Netlify functions. Use `netlify dev` to test `send-otp` or `chat-khalid` locally (requires `RESEND_API_KEY` and `ANTHROPIC_API_KEY` in a `.env` file at the repo root).

## Architecture

**RAFD Digital** is an AI-powered applicant screening platform targeting the Saudi market. It is a static multi-page site deployed on Netlify, with two serverless backend functions.

### Frontend (static files at repo root)

- All pages are standalone `.html` files — no framework, no bundler.
- **`style.css`** — shared stylesheet for all pages.
- **`i18n.js`** — the entire translation engine. It exports a `T` object with `ar` and `en` sub-objects, each containing every UI string keyed by dot-notation (e.g. `'nav.features'`). HTML elements use `data-i18n="key"` attributes that the engine resolves at runtime. Direction (`rtl`/`ltr`) is also toggled here. Language defaults to English; user choice is persisted in `localStorage`.

### Netlify Functions (`netlify/functions/`)

No `netlify.toml` is present — Netlify auto-discovers functions from the `netlify/functions/` directory.

| File | Purpose | Env var required |
|---|---|---|
| `send-otp.js` | Sends OTP verification emails via [Resend](https://resend.com) | `RESEND_API_KEY` |
| `chat-khalid.js` | Powers the "Khalid" AI chatbot using Claude Haiku | `ANTHROPIC_API_KEY` |

The chatbot function calls the Anthropic Messages API directly (`claude-haiku-4-5-20251001`). It keeps a 6-message rolling history per request. When the model includes `[ESCALATE]` in its output, the function strips the token and signals the frontend to display escalation UI.

### Local dev server (`server.js`)

A minimal Express server that serves all static files and provides a stub `POST /api/demo/analyze` endpoint (returns `{success:true}` after 500 ms). This is only used for local development — on Netlify, static files are served by the CDN and functions run as lambdas.

### Page groups

| Group | Files |
|---|---|
| Public marketing | `index.html`, `about.html`, `how-it-works.html`, `pricing.html`, `privacy.html`, `terms.html`, `partners.html` |
| Application flow | `demo-apply.html`, `apply.html`, `demo-jobs.html` |
| Partner portal | `register-partner.html`, `partner-login.html`, `partner-dashboard.html` |
| Admin / internal | `admin.html`, `dashboard.html`, `login.html`, `signup.html` |

### i18n conventions

- All new UI strings must be added to **both** `T.ar` and `T.en` in `i18n.js`.
- Keys follow a page-prefix dot-notation: `nav.*`, `hero.*`, `pg.*` (pricing page), `db.*` (dashboard), `rp.*` (register-partner), `apply.*`, `da.*` (demo-apply), `pl.*` (partner-login), `adm.*` (admin).
- Arabic is the primary language; English strings should match semantics exactly.
- Use `data-i18n-placeholder="key"` (not `data-i18n`) to translate `placeholder` attributes on inputs.
- For programmatic access to a translated string (e.g., in JS logic), use `getT('key')` — it reads from `localStorage` to pick the active language and falls back to Arabic.
- Pages can listen to the `rafd-lang-changed` CustomEvent on `document` (detail: `{ lang }`) to react to language switches without polling.
