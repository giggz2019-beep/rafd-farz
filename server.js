const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Security headers (replaces Netlify _headers)
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // HSTS — force HTTPS for 1 year, include subdomains
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');

  // CSP — this app uses inline scripts/styles, Google Fonts, Supabase, jsdelivr CDN
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "connect-src 'self' https://ycnnawohrbbluawxzttt.supabase.co https://api.resend.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '));

  // Legacy XSS filter (still checked by some government scanners)
  res.setHeader('X-XSS-Protection', '1; mode=block');

  next();
});

// Static files (CSS, images, JS, etc.)
app.use(express.static(path.join(__dirname)));
app.use(express.json());

// API demo endpoint
app.post('/api/demo/analyze', (req, res) => {
  setTimeout(() => {
    res.json({ success: true, message: 'تم التحليل' });
  }, 500);
});

// Clean URLs: /login → /login.html, /about → /about.html (replaces Netlify _redirects)
app.get('*', (req, res) => {
  const urlPath = req.path;

  if (urlPath === '/') {
    return res.sendFile(path.join(__dirname, 'index.html'));
  }

  // If URL has no extension, try serving the matching .html file
  if (!path.extname(urlPath)) {
    return res.sendFile(path.join(__dirname, urlPath + '.html'), (err) => {
      if (err) res.sendFile(path.join(__dirname, 'index.html'));
    });
  }

  // Otherwise serve the file as-is
  res.sendFile(path.join(__dirname, urlPath), (err) => {
    if (err) res.sendFile(path.join(__dirname, 'index.html'));
  });
});

app.listen(PORT, () => {
  console.log(`RAFD Digital running on port ${PORT}`);
});
