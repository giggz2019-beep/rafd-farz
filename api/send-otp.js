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
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;direction:rtl">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px">
  <tr><td align="center">
  <table width="100%" style="max-width:560px" cellpadding="0" cellspacing="0">

    <tr><td style="background:linear-gradient(135deg,#1a3a4a,#2d5a6e);border-radius:16px 16px 0 0;padding:28px 32px;text-align:center">
      <div style="font-size:1.6rem;font-weight:900;color:#fff;letter-spacing:-0.5px">RAFD Digital</div>
      <div style="font-size:.8rem;color:rgba(255,255,255,.7);margin-top:4px">منصة التقييم الذكي للمتقدمين</div>
    </td></tr>

    <tr><td style="background:#fff;padding:36px 32px">
      <p style="color:#1e293b;font-size:1rem;margin:0 0 6px;font-weight:700">مرحباً ${fname || 'بك'}،</p>
      <p style="color:#64748b;font-size:.92rem;margin:0 0 28px;line-height:1.7">
        تلقّينا طلباً للتحقق من بريدك الإلكتروني على منصة <strong style="color:#1a3a4a">RAFD Digital</strong>.<br>
        استخدم الرمز التالي لإتمام عملية التسجيل:
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px">
        <tr><td style="background:#f8fafc;border:2px dashed #cbd5e1;border-radius:14px;padding:28px;text-align:center">
          <div style="font-size:.75rem;color:#94a3b8;margin-bottom:10px;letter-spacing:1px">رمز التحقق</div>
          <div style="font-size:3rem;font-weight:900;letter-spacing:14px;color:#1a3a4a;font-family:'Courier New',monospace">${otp}</div>
          <div style="font-size:.78rem;color:#94a3b8;margin-top:10px">⏱ صالح لمدة <strong>10 دقائق</strong> فقط</div>
        </td></tr>
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
        <tr><td style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:16px 18px">
          <p style="margin:0;color:#92400e;font-size:.83rem;line-height:1.7">
            ⚠️ <strong>تنبيه أمني:</strong> لا تشارك هذا الرمز مع أي شخص أو جهة كانت، بما في ذلك موظفو RAFD Digital. فريقنا لن يطلب منك هذا الرمز أبداً. إذا لم تطلب هذا الرمز، يُرجى تجاهل هذا البريد.
          </p>
        </td></tr>
      </table>

      <p style="color:#94a3b8;font-size:.8rem;line-height:1.7;margin:0">
        إذا واجهت أي مشكلة، تواصل معنا عبر
        <a href="mailto:support@rafd-digital.com" style="color:#1a3a4a;font-weight:700;text-decoration:none">support@rafd-digital.com</a>
      </p>
    </td></tr>

    <tr><td style="background:#fff;padding:0 32px"><hr style="border:none;border-top:1px solid #f1f5f9;margin:0"></td></tr>

    <tr><td style="background:#fff;border-radius:0 0 16px 16px;padding:24px 32px;text-align:center">
      <p style="margin:0 0 6px;color:#94a3b8;font-size:.78rem">
        © 2026 <a href="https://rafd-digital.com" style="color:#1a3a4a;font-weight:700;text-decoration:none">RAFD Digital</a> — جميع الحقوق محفوظة
      </p>
      <p style="margin:0;color:#cbd5e1;font-size:.72rem">
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
