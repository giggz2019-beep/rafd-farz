const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname)));
app.use(express.json());

// API demo endpoint
app.post('/api/demo/analyze', (req, res) => {
  setTimeout(() => {
    res.json({ success: true, message: 'تم التحليل' });
  }, 500);
});

// Serve HTML files directly
app.get('*', (req, res) => {
  const filePath = req.path === '/' ? '/index.html' : req.path;
  const fullPath = path.join(__dirname, filePath);
  res.sendFile(fullPath, (err) => {
    if (err) {
      res.sendFile(path.join(__dirname, 'index.html'));
    }
  });
});

app.listen(PORT, () => {
  console.log(`RAFD Digital Platform running on port ${PORT}`);
});
