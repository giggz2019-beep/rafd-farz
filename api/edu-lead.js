'use strict';
// رفد تعليم — استقبال طلبات العرض من المدارس (نموذج الصفحة والمعرض).
// هذه هي نقطة النهاية الوحيدة في وحدة "رفد تعليم" التي يصلها زائر غير
// مسجَّل، ولذلك: كتابة فقط، على جدول واحد، بحقول محددة، مع تحديد معدل.
const { insert, cors } = require('./_lib/edu');
const { rateLimit, getIp } = require('./_lib/rate-limit');

const MAX = { school_name: 120, contact_name: 80, phone: 20, email: 120, city: 60, note: 600 };
const SOURCES = ['website', 'expo', 'referral'];
const SIZES = ['<200', '200-500', '500-1000', '1000+'];

function clean(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

// جوال سعودي: 05XXXXXXXX أو 9665XXXXXXXX أو +9665XXXXXXXX
function normalizePhone(raw) {
  const digits = String(raw || '').replace(/[^\d+]/g, '').replace(/^\+/, '');
  if (/^05\d{8}$/.test(digits)) return digits;
  if (/^9665\d{8}$/.test(digits)) return '0' + digits.slice(3);
  if (/^5\d{8}$/.test(digits)) return '0' + digits;
  return null;
}

async function notifySales(lead) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.EDU_SALES_EMAIL;
  // نفس اصطلاح المشروع: غياب الإعداد لا يُسقط الطلب — يُسجَّل تحذير فقط
  // والطلب يبقى محفوظاً في edu_leads.
  if (!key || !to) {
    console.warn('RESEND_API_KEY / EDU_SALES_EMAIL not set — lead email skipped');
    return;
  }
  const line = (k, v) => (v ? `<tr><td style="padding:6px 10px;color:#64748b">${k}</td><td style="padding:6px 10px;font-weight:600">${v}</td></tr>` : '');
  const html = `
<div style="font-family:'Segoe UI',Tahoma,Arial,sans-serif;direction:rtl;text-align:right;padding:24px;background:#f8fafc">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:24px;border:1px solid #e2e8f0">
    <div style="font-size:18px;font-weight:800;color:#0A1628;margin-bottom:4px">طلب عرض جديد — رفد تعليم</div>
    <div style="font-size:13px;color:#64748b;margin-bottom:16px">المصدر: ${lead.source}</div>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      ${line('المدرسة', lead.school_name)}
      ${line('المسؤول', lead.contact_name)}
      ${line('الجوال', lead.phone)}
      ${line('البريد', lead.email)}
      ${line('المدينة', lead.city)}
      ${line('عدد الطلاب', lead.students_est)}
      ${line('ملاحظة', lead.note)}
    </table>
  </div>
</div>`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EDU_FROM_EMAIL || 'RAFD Edu <noreply@rafd.digital>',
      to: [to],
      subject: `طلب عرض: ${lead.school_name}`,
      html,
    }),
  });
  if (!r.ok) throw new Error(`resend ${r.status}: ${await r.text()}`);
}

module.exports = async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const ip = getIp(req);
  const { limited } = await rateLimit(`edu-lead:${ip}`, 6, 10 * 60 * 1000);
  if (limited) return res.status(429).json({ error: 'طلبات كثيرة. حاول بعد قليل.' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    // حقل مصيدة: تملؤه الروبوتات ولا يراه المستخدم — نردّ بنجاح صامت
    if (clean(body.website, 50)) return res.status(200).json({ ok: true });

    const school_name = clean(body.school_name, MAX.school_name);
    const contact_name = clean(body.contact_name, MAX.contact_name);
    const phone = normalizePhone(body.phone);
    if (!school_name || !contact_name) {
      return res.status(400).json({ error: 'اسم المدرسة واسم المسؤول مطلوبان' });
    }
    if (!phone) return res.status(400).json({ error: 'رقم الجوال غير صحيح' });

    const email = clean(body.email, MAX.email);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: 'البريد الإلكتروني غير صحيح' });
    }

    const lead = {
      school_name,
      contact_name,
      phone,
      email: email || null,
      city: clean(body.city, MAX.city) || null,
      students_est: SIZES.includes(body.students_est) ? body.students_est : null,
      source: SOURCES.includes(body.source) ? body.source : 'website',
      note: clean(body.note, MAX.note) || null,
      status: 'new',
    };

    await insert('edu_leads', [lead]);
    // فشل الإشعار لا يُفشل الطلب — البيانات محفوظة أصلاً
    notifySales(lead).catch((e) => console.error('lead email failed:', e.message));

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('edu-lead error:', e.message);
    return res.status(500).json({ error: 'تعذّر إرسال الطلب. حاول مرة أخرى.' });
  }
};
