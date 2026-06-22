# RAFD Digital — Codebase Guide

## What This Is

RAFD Digital is a static Arabic-language marketing and onboarding website for an AI-powered applicant-screening SaaS platform. It is hosted on **Netlify** (static hosting, no server-side rendering at runtime). The `server.js` file exists only for local development via `node server.js`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| HTML/CSS | Vanilla HTML5, inline styles (per-page), one shared `css/style.css` for the landing page |
| JavaScript | Vanilla JS (no framework), Supabase JS SDK v2 loaded via CDN |
| Backend / DB | [Supabase](https://supabase.com) — PostgreSQL database + Auth |
| Hosting | Netlify (static) |
| Font | Cairo (Google Fonts) |
| Language / Direction | Arabic (`lang="ar" dir="rtl"`) |

---

## Directory Structure

```
rafd-website/
├── index.html              # Main landing page
├── css/
│   └── style.css           # Shared stylesheet (used by index.html and other marketing pages)
├── images/
│   ├── rafd-logo.png       # Primary logo
│   ├── rafd-logo.jpg
│   ├── khalid.png          # AI chatbot avatar
│   └── rafd-team.png
├── login.html              # Subscriber login (Supabase auth against partners table)
├── signup.html             # Subscriber registration (inserts into partners table)
├── dashboard.html          # Main subscriber dashboard (UI only, no auth guard yet)
├── partner-login.html      # Partner/org login (Supabase auth against partners table)
├── partner-dashboard.html  # Partner dashboard
├── register-partner.html   # Full partner registration with OTP email verification
├── admin.html              # Admin panel
├── about.html
├── how-it-works.html
├── partners.html
├── pricing.html
├── privacy.html
├── terms.html
├── demo-apply.html         # Interactive demo application form
├── demo-jobs.html
├── _redirects              # Netlify URL rewrite rules (strips .html from URLs)
├── server.js               # Express server for local dev only
├── package.json
└── CLAUDE.md               # This file
```

> **Note:** `style.css` and the image files also exist at the repository root (legacy). Always use the paths under `css/` and `images/` since that is what the HTML files reference.

---

## Supabase Configuration

All pages that need data access include the Supabase JS SDK and these credentials:

```javascript
const SUPABASE_URL = 'https://ycnnawohrbbluawxzttt.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RgOring3FCEiBMGYPcPmZg_s_85Yc_f';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
```

### Known Tables

#### `partners`
Stores both subscribers (from `signup.html`) and registered partners (from `register-partner.html`).

| Column | Type | Notes |
|---|---|---|
| `id` | int (auto) | Primary key |
| `fname` | text | First name |
| `lname` | text | Last name |
| `org_name` | text | Organization name |
| `org_type` | text | Type of organization |
| `city` | text | City |
| `email` | text | Unique login email |
| `password` | text | `btoa()`-encoded password (not bcrypt — demo only) |
| `phone` | text | |
| `title` | text | Job title |
| `website` | text | |
| `plan` | text | `'trial'`, `'basic'`, or `'pro'` |
| `status` | text | `'approved'`, `'pending'`, `'rejected'` |
| `ref_num` | text | e.g. `RAFD-2025-12345` |
| `purpose` | text | Intended use case |
| `volume` | text | Expected monthly volume |
| `notes` | text | Free-text notes |

---

## Authentication Flow

### Subscribers (`login.html` / `signup.html`)
- **Signup**: Validates fields → checks for duplicate email in `partners` table → inserts new row with `status: 'approved'`, `plan: 'trial'` → saves session to `localStorage` as `rafd_session`
- **Login**: Queries `partners` table by email → compares `atob(stored_password)` with entered password → saves `rafd_session` to `localStorage` → redirects to `/dashboard.html`

### Partners (`partner-login.html` / `register-partner.html`)
- **Registration**: Full form with OTP email verification via `supabase.auth.signInWithOtp()` → on OTP success, inserts into `partners` table with `status: 'pending'` → saves `rafd_partner_session` to `localStorage`
- **Login**: Same DB query pattern as subscriber login → saves `rafd_partner_session` → redirects to `/partner-dashboard.html`

### Session Storage Keys
| Key | Used by |
|---|---|
| `rafd_session` | `login.html` / `signup.html` |
| `rafd_partner_session` | `partner-login.html` / `register-partner.html` |

---

## Key Conventions

- **No build step.** All HTML is served as-is. No bundler, no transpiler.
- **Inline styles per page.** Most pages embed all their CSS in a `<style>` block. Only the landing page (`index.html`) uses the external `/css/style.css`.
- **RTL first.** All pages use `dir="rtl"` and Arabic text. Keep this in all new pages.
- **Arabic UI.** All user-facing strings must be in Arabic.
- **Supabase SDK via CDN.** Load with `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>` — one `<script>` tag only, no duplicate closing tags.
- **Password encoding.** Passwords are stored as `btoa(password)` (Base64). This is for demo purposes only — not secure for production.
- **Netlify `_redirects`.** Every new `.html` page should get a clean-URL redirect entry in `_redirects`.

---

## Local Development

```bash
npm install
npm run dev   # starts Express on port 3000
```

Then open `http://localhost:3000`.

---

## Common Tasks

### Add a new page
1. Create `pagename.html` in the root
2. Add a redirect to `_redirects`: `/pagename   /pagename.html   200`
3. Link to `/pagename` (not `/pagename.html`) from other pages

### Add a new Supabase table
1. Create the table in the Supabase dashboard
2. Update RLS policies as needed
3. Document the schema in this file under "Known Tables"

### Change Supabase credentials
Update the `SUPABASE_URL` and `SUPABASE_KEY` variables in every HTML file that uses Supabase:
`login.html`, `signup.html`, `partner-login.html`, `register-partner.html`, `admin.html`, `partner-dashboard.html`, `dashboard.html`

---

## Known Issues / TODO

- Passwords are stored as `btoa()` (Base64) — replace with a proper hashing solution before production
- `dashboard.html` has no session guard — any unauthenticated user can visit it directly
- `admin.html` has no authentication guard
- The `khalid` AI chatbot on `index.html` uses a local keyword-matching system, not a real LLM
