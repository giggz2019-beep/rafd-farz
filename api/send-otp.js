module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { email, otp, fname } = req.body || {};

    if (!email || !otp) {
      return res.status(400).json({ error: 'Missing email or otp' });
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'RAFD Digital <noreply@rafd-digital.com>',
        to: [email],
        subject: `${otp} - رمز التفعيل في RAFD Digital`,
        html: `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:'Cairo','Segoe UI',Arial,sans-serif;direction:rtl">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:40px 16px">
<tr><td align="center">
<table width="100%" style="max-width:580px" cellpadding="0" cellspacing="0">

  <!-- HEADER -->
  <tr><td style="background:linear-gradient(135deg,#0d2233 0%,#1a3a4a 50%,#1e5c42 100%);border-radius:20px 20px 0 0;padding:32px 36px;text-align:center">
    <img src="https://rafd-digital.com/rafd-logo.png" alt="RAFD Digital" width="80" height="80"
      style="border-radius:14px;background:#fff;padding:6px;box-shadow:0 4px 20px rgba(0,0,0,.3);margin-bottom:14px;display:block;margin-left:auto;margin-right:auto">
    <div style="font-size:1.55rem;font-weight:900;color:#fff;letter-spacing:-.5px;font-family:'Cairo',sans-serif">RAFD Digital</div>
    <div style="font-size:.8rem;color:rgba(255,255,255,.6);margin-top:5px;letter-spacing:.5px">منصة التقييم الذكي للمتقدمين</div>
  </td></tr>

  <!-- ACCENT LINE -->
  <tr><td style="height:4px;background:linear-gradient(90deg,#1a3a4a,#4a9d6f,#38bdf8)"></td></tr>

  <!-- BODY -->
  <tr><td style="background:#ffffff;padding:40px 36px">

    <p style="color:#0d2233;font-size:1.05rem;margin:0 0 8px;font-weight:700;font-family:'Cairo',sans-serif">مرحباً ${fname || ''}،</p>
    <p style="color:#5a6a7e;font-size:.9rem;margin:0 0 30px;line-height:1.85;font-family:'Cairo',sans-serif">
      تلقّينا طلب تحقق من هويتك على منصة <strong style="color:#1a3a4a">RAFD Digital</strong>.<br>
      استخدم الرمز أدناه لإتمام التسجيل:
    </p>

    <!-- OTP BOX -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:30px">
      <tr><td style="background:linear-gradient(135deg,#f0f7ff,#e8f5ee);border:2px solid #c8dfe8;border-radius:16px;padding:30px 20px;text-align:center">
        <div style="font-size:.7rem;color:#8fa3b1;margin-bottom:12px;letter-spacing:2px;text-transform:uppercase;font-family:'Cairo',sans-serif">رمز التحقق الخاص بك</div>
        <div style="font-size:3.2rem;font-weight:900;letter-spacing:16px;color:#0d2233;font-family:'Courier New',monospace;text-shadow:0 2px 4px rgba(13,34,51,.1)">${otp}</div>
        <div style="margin-top:14px;display:inline-block;background:#fff3cd;border:1px solid #f0c040;border-radius:20px;padding:5px 16px">
          <span style="font-size:.75rem;color:#856404;font-family:'Cairo',sans-serif">⏱ صالح لمدة <strong>10 دقائق</strong> فقط</span>
        </div>
      </td></tr>
    </table>

    <!-- SECURITY NOTE -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px">
      <tr><td style="background:#fff8f0;border-right:4px solid #f59e0b;border-radius:0 10px 10px 0;padding:14px 16px">
        <p style="margin:0;color:#7c4a03;font-size:.82rem;line-height:1.8;font-family:'Cairo',sans-serif">
          <strong>تنبيه أمني:</strong> لا تشارك هذا الرمز مع أي شخص. فريق RAFD Digital لن يطلبه منك أبداً.
          إذا لم تطلب هذا الرمز، تجاهل هذا البريد.
        </p>
      </td></tr>
    </table>

    <p style="color:#94a3b8;font-size:.8rem;line-height:1.7;margin:0;font-family:'Cairo',sans-serif">
      تواصل معنا عبر
      <a href="mailto:support@rafd-digital.com" style="color:#1a3a4a;font-weight:700;text-decoration:none">support@rafd-digital.com</a>
    </p>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:linear-gradient(135deg,#0d2233,#1a3a4a);border-radius:0 0 20px 20px;padding:24px 36px;text-align:center">
    <p style="margin:0 0 10px;color:rgba(255,255,255,.5);font-size:.78rem;font-family:'Cairo',sans-serif">
      © 2026 <a href="https://rafd-digital.com" style="color:#4a9d6f;font-weight:700;text-decoration:none">RAFD Digital</a> — جميع الحقوق محفوظة
    </p>
    <p style="margin:0;color:rgba(255,255,255,.3);font-size:.72rem;font-family:'Cairo',sans-serif">
      تلقيت هذا البريد لأن بريدك الإلكتروني استُخدم للتسجيل في منصتنا
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: data });
    return res.status(200).json({ success: true });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
