# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in RAFD Digital, please report it responsibly.

**Do not** open a public GitHub issue for security vulnerabilities.

### Contact

Send your report to: **security@rafd-digital.com**

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fixes (optional)

We will acknowledge receipt within 48 hours and aim to resolve critical issues within 7 days.

## Security Headers

This site is configured with the following security headers:

- `Content-Security-Policy` — restricts script/style/font/image sources
- `Strict-Transport-Security` — enforces HTTPS
- `X-Frame-Options: DENY` — prevents clickjacking
- `X-Content-Type-Options: nosniff` — prevents MIME sniffing
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-site`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` — disables camera, microphone, and geolocation

## Scope

The following are in scope for vulnerability reports:

- The RAFD Digital web application (`rafd.digital`)
- Authentication flows (login, signup, OTP verification)
- Partner dashboard and admin panel
- Supabase integration and data handling

## Out of Scope

- Third-party services (Supabase, CDN providers)
- Social engineering attacks
- Denial of service attacks
