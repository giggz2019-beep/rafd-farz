# RAFD Digital Security Hardening

## ✅ Security Improvements Implemented

### 1. OTP Generation (Server-Side)
- ✅ OTP now generated on the server, never on client
- ✅ HMAC-SHA256 challenge tokens for validation
- ✅ Timing-safe comparison to prevent timing attacks
- ✅ 10-minute expiry window

**File:** `api/send-otp.js`

### 2. Rate Limiting
- ✅ 3 OTP send attempts per 10 minutes per IP
- ✅ 5 OTP verify attempts per 10 minutes per IP
- ✅ Distributed-ready (In-memory with optional Redis)
- ✅ HTTP 429 responses on rate limit exceeded

**File:** `api/_lib/rate-limit.js`

### 3. Security Headers (CSP, HSTS, X-Frame-Options)
- ✅ Content-Security-Policy with static-site-compatible defaults
- ✅ Inline script/style support enabled temporarily because the current pages rely on inline `<style>`, inline `<script>`, and `onclick` handlers
- ✅ HSTS with 1-year max-age
- ✅ Frame-ancestors set to 'none'
- ✅ Referrer-Policy: strict-origin-when-cross-origin

**Files:** `server.js`, `vercel.json`

### 4. CORS Hardening
- ✅ `ALLOWED_ORIGIN` environment variable (configurable)
- ✅ Removed hardcoded Supabase URL from CSP
- ✅ Proper CORS headers in API endpoints

**File:** `api/send-otp.js`, `server.js`

### 5. Environment Variables
- ✅ `.env.example` template with all required keys
- ✅ `PARTNER_SECRET` for OTP token signing
- ✅ `ALLOWED_ORIGIN` for CORS
- ✅ `.env` excluded from Git (add to `.gitignore`)

**File:** `.env.example`

### 6. Audit Logging
- ✅ Event logging for authentication attempts
- ✅ IP tracking for failed attempts
- ✅ Webhook support for remote audit logs
- ✅ Local in-memory store (last 1000 events)

**File:** `api/_lib/audit.js`

### 7. Input Validation
- ✅ Email format validation
- ✅ OTP format validation (6 digits only)
- ✅ HTML sanitization for user inputs
- ✅ SQL injection prevention (use parameterized queries)

**File:** `api/send-otp.js`

## 🔧 Setup Instructions

### 1. Create `.env` file (from `.env.example`)
```bash
cp .env.example .env
```

### 2. Fill in your values
```bash
ALLOWED_ORIGIN=https://rafd-digital.com
PARTNER_SECRET=your-secure-random-string-32-chars
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-key
RESEND_API_KEY=your-key
```

### 3. Add `.env` to `.gitignore`
```bash
echo ".env" >> .gitignore
git add .gitignore
git commit -m "Add .env to gitignore"
```

### 4. Install dependencies (if needed)
```bash
npm install express
```

### 5. Test locally
```bash
node server.js
# Should see: 🚀 RAFD Digital Platform running on port 3000
```

## 🚀 Deployment (Vercel)

1. Go to Vercel dashboard
2. Select your project
3. Settings → Environment Variables
4. Add all variables from `.env`
5. Deploy

**Note:** `vercel.json` is configured to set headers automatically.

## 📋 Checklist for Production

- [ ] `.env` file created and filled
- [ ] `.env` added to `.gitignore`
- [ ] `PARTNER_SECRET` is a strong random string (32+ chars)
- [ ] `ALLOWED_ORIGIN` matches your domain
- [ ] Supabase credentials are valid
- [ ] Resend API key is valid
- [ ] Vercel environment variables are set
- [ ] HTTPS enforced on domain
- [ ] Replace inline page CSS/JS with external assets, then remove `'unsafe-inline'` from CSP
- [ ] Rate limiting active
- [ ] Audit logging enabled

## 🔐 Security Best Practices

1. **Never commit `.env`** — Always use environment variables
2. **Rotate secrets regularly** — Update `PARTNER_SECRET` quarterly
3. **Monitor rate limits** — Watch for brute force attempts
4. **Review audit logs** — Check for suspicious activity
5. **Keep dependencies updated** — Run `npm audit` regularly
6. **Use HTTPS everywhere** — Enforce TLS/SSL
7. **Test CSP** — Verify headers with browser DevTools and keep CSP aligned with the current frontend architecture
8. **CORS restrictions** — Only allow trusted origins

## 📞 Support

For security issues, email: **security@rafd-digital.com**

---

**Last Updated:** 2026-07-05  
**Status:** ✅ Production Ready (with temporary CSP compatibility allowance for current static pages)
