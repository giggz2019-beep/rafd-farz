'use strict';
// رفد تعليم — المصادقة
// الأدوار: school_admin | teacher | parent | student
//
// الإجراءات:
//   login          { school_code?, identifier, password }  → { token, user }
//   request_otp    { identifier }                          → { ok }  (يُرسل رمزاً بالبريد)
//   verify_otp     { identifier, code }                    → { token, user }
//   me             { token }                               → { user }
//   change_password{ token, current_password, new_password }
//
// identifier = البريد الإلكتروني أو رقم الجوال أو رقم الهوية.
const crypto = require('crypto');
const { hash: hashPassword, verify: verifyPassword } = require('./_lib/password');
const { rateLimit, getIp } = require('./_lib/rate-limit');
const {
  select, insert, update, remove, q, cors, issueToken, validateToken,
} = require('./_lib/edu');

const OTP_TTL_MS = 10 * 60 * 1000; // 10 دقائق
const OTP_MAX_ATTEMPTS = 5;

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function normalize(identifier) {
  return String(identifier || '').trim();
}

// يبحث عن المستخدم بالبريد أو الجوال أو رقم الهوية
async function findUser(identifier) {
  const v = normalize(identifier);
  if (!v) return null;
  const enc = encodeURIComponent(q(v));
  const rows = await select(
    `/edu_users?or=(email.eq.${enc},phone.eq.${enc},national_id.eq.${enc})&active=is.true&select=*&limit=2`
  );
  // معرّف مكرر بين مدرستين → نرفض بدل اختيار حساب عشوائي
  if (!rows || rows.length !== 1) return null;
  return rows[0];
}

function publicUser(u, school) {
  return {
    id: u.id,
    role: u.role,
    full_name: u.full_name,
    email: u.email,
    phone: u.phone,
    avatar_url: u.avatar_url,
    school_id: u.school_id,
    school_name: school?.name || null,
    school_logo: school?.logo_url || null,
  };
}

async function getSchool(schoolId) {
  const rows = await select(`/edu_schools?id=eq.${schoolId}&select=id,name,name_en,logo_url,stage,city,plan,active&limit=1`);
  return rows?.[0] || null;
}

async function sendOtpEmail(email, code, fullName) {
  const key = process.env.RESEND_API_KEY;
  // نفس اصطلاح المشروع: غياب المفتاح لا يُسقط الخدمة — يُسجَّل تحذير فقط
  if (!key) {
    console.warn('RESEND_API_KEY not set — OTP email skipped');
    return false;
  }
  const html = `
<div style="font-family:'Segoe UI',Tahoma,Arial,sans-serif;direction:rtl;text-align:right;background:#f8fafc;padding:32px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;border:1px solid #e2e8f0">
    <div style="font-size:20px;font-weight:800;color:#0A1628;margin-bottom:8px">رفد تعليم</div>
    <p style="color:#475569;font-size:15px;line-height:1.9;margin:0 0 20px">
      مرحباً ${fullName || ''}، رمز الدخول الخاص بك:
    </p>
    <div style="background:#0A1628;color:#fff;font-size:30px;font-weight:800;letter-spacing:10px;text-align:center;padding:18px;border-radius:12px">${code}</div>
    <p style="color:#94a3b8;font-size:13px;line-height:1.8;margin:20px 0 0">
      الرمز صالح لمدة 10 دقائق. إذا لم تطلب هذا الرمز فتجاهل الرسالة.
    </p>
  </div>
</div>`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EDU_FROM_EMAIL || 'RAFD Edu <noreply@rafd.digital>',
      to: [email],
      subject: `رمز الدخول: ${code}`,
      html,
    }),
  });
  if (!r.ok) throw new Error(`resend ${r.status}: ${await r.text()}`);
  return true;
}

module.exports = async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const action = body.action;
  const ip = getIp(req);

  try {
    // ── تسجيل الدخول بكلمة المرور ──────────────────────────────────────────
    if (action === 'login') {
      const { limited } = await rateLimit(`edu-login:${ip}`, 10, 15 * 60 * 1000);
      if (limited) return res.status(429).json({ error: 'محاولات كثيرة. حاول بعد قليل.' });

      const user = await findUser(body.identifier);
      const stored = user?.password_hash;
      // نتحقق دائماً حتى لو لم يوجد المستخدم — لتفادي تسريب وجود الحساب بفارق التوقيت
      const { valid, needsRehash } = verifyPassword(String(body.password || ''), stored || 'scrypt:00:00');
      if (!user || !stored || !valid) {
        return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
      }
      if (needsRehash) {
        await update('edu_users', `id=eq.${user.id}`, { password_hash: hashPassword(String(body.password)) });
      }
      const school = await getSchool(user.school_id);
      if (!school || school.active === false) {
        return res.status(403).json({ error: 'حساب المدرسة غير مُفعّل' });
      }
      await update('edu_users', `id=eq.${user.id}`, { last_login_at: new Date().toISOString() });
      return res.status(200).json({ token: issueToken(user), user: publicUser(user, school) });
    }

    // ── طلب رمز تحقق ───────────────────────────────────────────────────────
    if (action === 'request_otp') {
      const { limited } = await rateLimit(`edu-otp:${ip}`, 5, 15 * 60 * 1000);
      if (limited) return res.status(429).json({ error: 'طلبات كثيرة. حاول بعد قليل.' });

      const user = await findUser(body.identifier);
      // ردّ موحّد سواء وُجد الحساب أم لا — لا نكشف الحسابات المسجّلة
      if (user?.email) {
        const code = String(crypto.randomInt(100000, 1000000));
        await insert('edu_otp', [{
          identifier: normalize(body.identifier),
          code_hash: hashCode(code),
          expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
        }]);
        try {
          await sendOtpEmail(user.email, code, user.full_name);
        } catch (e) {
          console.error('OTP email failed:', e.message);
        }
      }
      return res.status(200).json({ ok: true });
    }

    // ── التحقق من الرمز ────────────────────────────────────────────────────
    if (action === 'verify_otp') {
      const { limited } = await rateLimit(`edu-otpv:${ip}`, 15, 15 * 60 * 1000);
      if (limited) return res.status(429).json({ error: 'محاولات كثيرة. حاول بعد قليل.' });

      const identifier = normalize(body.identifier);
      const enc = encodeURIComponent(q(identifier));
      const rows = await select(
        `/edu_otp?identifier=eq.${enc}&select=*&order=created_at.desc&limit=1`
      );
      const rec = rows?.[0];
      if (!rec) return res.status(401).json({ error: 'الرمز غير صحيح' });
      if (new Date(rec.expires_at).getTime() < Date.now()) {
        await remove('edu_otp', `id=eq.${rec.id}`);
        return res.status(401).json({ error: 'انتهت صلاحية الرمز' });
      }
      if (rec.attempts >= OTP_MAX_ATTEMPTS) {
        await remove('edu_otp', `id=eq.${rec.id}`);
        return res.status(429).json({ error: 'تم تجاوز عدد المحاولات' });
      }
      const given = Buffer.from(hashCode(String(body.code || '')), 'hex');
      const want = Buffer.from(rec.code_hash, 'hex');
      const ok = given.length === want.length && crypto.timingSafeEqual(given, want);
      if (!ok) {
        await update('edu_otp', `id=eq.${rec.id}`, { attempts: rec.attempts + 1 });
        return res.status(401).json({ error: 'الرمز غير صحيح' });
      }
      await remove('edu_otp', `id=eq.${rec.id}`);

      const user = await findUser(identifier);
      if (!user) return res.status(401).json({ error: 'الحساب غير موجود' });
      const school = await getSchool(user.school_id);
      if (!school || school.active === false) {
        return res.status(403).json({ error: 'حساب المدرسة غير مُفعّل' });
      }
      await update('edu_users', `id=eq.${user.id}`, { last_login_at: new Date().toISOString() });
      return res.status(200).json({ token: issueToken(user), user: publicUser(user, school) });
    }

    // ── جلب المستخدم الحالي ────────────────────────────────────────────────
    if (action === 'me') {
      const session = validateToken(body.token);
      if (!session) return res.status(401).json({ error: 'انتهت الجلسة' });
      const rows = await select(`/edu_users?id=eq.${session.id}&active=is.true&select=*&limit=1`);
      const user = rows?.[0];
      if (!user) return res.status(401).json({ error: 'الحساب غير موجود' });
      const school = await getSchool(user.school_id);
      return res.status(200).json({ user: publicUser(user, school) });
    }

    // ── تغيير كلمة المرور ──────────────────────────────────────────────────
    if (action === 'change_password') {
      const session = validateToken(body.token);
      if (!session) return res.status(401).json({ error: 'انتهت الجلسة' });
      const next = String(body.new_password || '');
      if (next.length < 8) {
        return res.status(400).json({ error: 'كلمة المرور يجب ألا تقل عن 8 أحرف' });
      }
      const rows = await select(`/edu_users?id=eq.${session.id}&select=*&limit=1`);
      const user = rows?.[0];
      if (!user) return res.status(401).json({ error: 'الحساب غير موجود' });
      const { valid } = verifyPassword(String(body.current_password || ''), user.password_hash || 'scrypt:00:00');
      if (!valid) return res.status(401).json({ error: 'كلمة المرور الحالية غير صحيحة' });
      await update('edu_users', `id=eq.${user.id}`, { password_hash: hashPassword(next) });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'إجراء غير معروف' });
  } catch (e) {
    console.error('edu-auth error:', e.message);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
};
