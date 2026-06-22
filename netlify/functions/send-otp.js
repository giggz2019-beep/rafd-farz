exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { email, otp, fname } = JSON.parse(event.body || '{}');

    if (!email || !otp) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing email or otp' }) };
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'RAFD Digital <noreply@rafd-digital.com>',
        to: [email],
        subject: `${otp} - رمز التفعيل في RAFD Digital`,
        html: `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#f8fafc;border-radius:12px">
          <div style="background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.06)">
            <h2 style="color:#1a3a4a;margin:0 0 8px">مرحباً ${fname || ''}،</h2>
            <p style="color:#475569;margin:0 0 24px">رمز التفعيل الخاص بك في منصة RAFD Digital هو:</p>
            <div style="background:#f0f9ff;border:2px solid #38bdf8;border-radius:12px;padding:24px;text-align:center;margin:0 0 24px">
              <span style="font-size:2.8rem;font-weight:900;letter-spacing:10px;color:#1a3a4a;font-family:monospace">${otp}</span>
            </div>
            <p style="color:#64748b;font-size:.88rem;margin:0">الرمز صالح لمدة 10 دقائق. لا تشاركه مع أحد.</p>
          </div>
          <p style="text-align:center;color:#94a3b8;font-size:.78rem;margin:16px 0 0">RAFD Digital — منصة التقييم الذكي</p>
        </div>`
      })
    });

    const data = await res.json();

    if (!res.ok) {
      return { statusCode: 500, body: JSON.stringify({ error: data }) };
    }

    return { statusCode: 200, body: JSON.stringify({ success: true }) };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
