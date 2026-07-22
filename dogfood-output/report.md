# Dogfood Report: RAFD Digital

| Field | Value |
|-------|-------|
| **Date** | 2026-07-22 |
| **App URL** | http://localhost:3000 |
| **Session** | rafd |
| **Scope** | Full public site (local dev server — serverless functions in `api/` not available) |

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 2 |
| Medium | 0 |
| Low | 2 |
| **Total** | **4** |

## Issues

### ISSUE-001: Entire site stays RTL when language is English

| Field | Value |
|-------|-------|
| **Severity** | high |
| **Category** | visual / i18n |
| **URL** | http://localhost:3000/ (affects all pages) |
| **Repro Video** | N/A (visible on load) |

**Description**

With the language set to English, `i18n.js` correctly sets `<html dir="ltr" lang="en">`, but `style.css:35` hardcodes `body { direction: rtl; }` and no `[dir="ltr"]` override exists anywhere in the stylesheet. Computed `direction` on `<body>` is `rtl` in English mode. As a result all English text is right-aligned with mirrored punctuation — e.g. the hero paragraph renders "…without bias, in **.minutes**" with the period on the wrong side, and arrows/CTA ordering is mirrored.

**Fix direction:** change `style.css` to `html[dir="ltr"] body { direction: ltr; }` (or move `direction` off `body` and rely on the `dir` attribute i18n.js already sets).

**Evidence**

![English page rendered RTL](screenshots/issue-001-en-rtl.png)

---

### ISSUE-002: Hardcoded Arabic strings leak into English mode (footer + Khalid widget)

| Field | Value |
|-------|-------|
| **Severity** | low |
| **Category** | content / i18n |
| **URL** | http://localhost:3000/ |
| **Repro Video** | N/A (visible on load) |

**Description**

In English mode the footer still shows the Arabic link "سياسة الاسترداد" (refund policy, `index.html:672`) because it has no `data-i18n` attribute, and the Khalid widget's WhatsApp link/title is hardcoded "واتساب" (`index.html:782`, `:897`). All other footer links are translated. The pricing page also leaks Arabic in English mode: the "شهرياً" (monthly) label and the annual-savings lines "4,788 ر.س سنوياً — وفّر 1,200 ر.س" render untranslated (see `screenshots/pricing-en.png`). These strings need i18n keys in both `T.ar` and `T.en`.

**Evidence**

![Footer with Arabic link in English mode](screenshots/issue-002-footer-arabic-in-en.png)

---

### ISSUE-003: Local dev server CSP is stricter than production — kills ALL inline JS and inline styles in local dev

| Field | Value |
|-------|-------|
| **Severity** | high |
| **Category** | functional / dev-prod parity |
| **URL** | all pages served by `node server.js` |
| **Repro Video** | N/A (verified via DOM inspection) |

**Description**

`server.js` sends `Content-Security-Policy: script-src 'self' https://cdn.jsdelivr.net; style-src 'self' https://fonts.googleapis.com; ...` — **without** `'unsafe-inline'` in either directive. Production (`vercel.json`) includes `'unsafe-inline'` in both. The site relies heavily on inline code, so under the local server:

- Every `onclick="..."` attribute is dead — the language toggle, Khalid chat button, login dropdown, and hamburger menu do nothing when clicked (verified: `btn.onclick === null`, wrapping `setLang` recorded zero calls on click).
- Every inline `<script>` block is blocked — `typeof toggleKhalid === "undefined"` on the homepage.
- Every inline `style="..."` attribute is ignored — 136 elements on the homepage, so all `display:none` sections (mobile menu, chat panel contents) render visible.
- Inline `<style>` blocks are blocked — `partner-login.html` (whose entire stylesheet is an inline `<style>` block) renders as completely unstyled raw HTML (see screenshot).

Anyone QA-ing locally will conclude the whole site is broken while production is fine — and conversely, a page that *depends* on the strict local CSP passing would break in production. The two policies should match (either add `'unsafe-inline'` to `server.js` to mirror `vercel.json`, or better, generate both from one source).

**Evidence**

![Homepage with display:none elements visible and dead handlers](screenshots/issue-003-csp-inline-blocked.png)
![partner-login rendered unstyled because its inline <style> block is CSP-blocked](screenshots/partner-login.png)

---

### ISSUE-004: Page `<title>` never translated — stays Arabic in English mode

| Field | Value |
|-------|-------|
| **Severity** | low |
| **Category** | content / i18n |
| **URL** | all pages |
| **Repro Video** | N/A |

**Description**

With language set to English (`localStorage rafd_lang = "en"`), every page keeps its Arabic `<title>`, e.g. `apply.html` shows "تقديم الطلب — RAFD Digital" and `pricing.html` shows "الباقات والأسعار — RAFD Digital" in the browser tab. `setLang()` in `i18n.js` translates `[data-i18n]` elements but never touches `document.title`. Add a `title` i18n key per page (or a `data-i18n` handling branch for the `<title>` element).

---
