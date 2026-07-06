const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// ===== SECURITY HEADERS =====
app.use((req, res, next) => {
  // X-Frame-Options — Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  
  // X-Content-Type-Options — Prevent MIME-type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Referrer-Policy — Control referrer information
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Permissions-Policy — Restrict browser features
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  
  // HSTS — Force HTTPS for 1 year, include subdomains
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  
  // X-XSS-Protection — Legacy XSS filter (for old browsers)
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Content-Security-Policy — compatible with the current static inline HTML/CSS/JS architecture
  const supabaseUrl = process.env.SUPABASE_URL || 'https://ycnnawohrbbluawxzttt.supabase.co';
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    `connect-src 'self' ${supabaseUrl} https://api.resend.com`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '));
  
  next();
});

// ===== MIDDLEWARE =====
app.use(express.static(path.join(__dirname)));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// ===== REQUEST LOGGING (Development) =====
if (NODE_ENV === 'development') {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
    });
    next();
  });
}

// ===== HEALTH CHECK =====
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ===== API ROUTES =====
app.post('/api/demo/analyze', (req, res) => {
  setTimeout(() => {
    res.json({ success: true, message: 'تم التحليل' });
  }, 500);
});

// ===== STATIC FILE SERVING =====
app.get('*', (req, res) => {
  const filePath = req.path === '/' ? '/index.html' : req.path;
  const fullPath = path.join(__dirname, filePath);
  
  res.sendFile(fullPath, (err) => {
    if (err) {
      res.sendFile(path.join(__dirname, 'index.html'));
    }
  });
});

// ===== ERROR HANDLER =====
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log(`🚀 RAFD Digital Platform running on port ${PORT}`);
  console.log(`📋 Environment: ${NODE_ENV}`);
  console.log(`🔐 Security headers: ENABLED`);
  if (process.env.SUPABASE_URL) console.log(`🏛️  Government integration: READY`);
});
