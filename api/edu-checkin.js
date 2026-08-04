'use strict';
// رفد تعليم — تسجيل الحضور بالباركود / الرقم السري / الإدخال اليدوي.
//
// الشاشة (edu-kiosk.html) تعمل على جهاز الإدارة بجلسة كادر، ولذلك كل
// إجراء هنا يتطلب توكن كادر صالحاً. الطالب أو المعلم لا يستدعي هذا
// الملف مباشرة — هو يمرّر رمزه فقط أمام القارئ.
//
// الإجراءات:
//   scan     { token, code }                  → يطابق ويسجّل الحضور
//   lookup   { token, q }                     → بحث بالاسم/الهوية/رقم الطالب
//   manual   { token, kind, id }              → تسجيل يدوي بعد البحث
//   feed     { token }                        → سجل اليوم المباشر
//   self     { token, status, reason }        → المنسوب يسجّل نفسه (غياب/حضور)
//   issue_codes { token }                     → توليد رموز لمن لا رمز له
const crypto = require('crypto');
const { verify: verifyPassword, hash: hashPassword } = require('./_lib/password');
const { rateLimit, getIp } = require('./_lib/rate-limit');
const {
  select, insert, update, q, cors, validateToken, isStaff, todayISO,
} = require('./_lib/edu');

const ROLL_WINDOW = 30000; // يجب أن يطابق Edu.ROLL_WINDOW في edu-common.js

// نفس تجزئة FNV-1a المستخدمة في المتصفح — الرمز المتغير يجب أن يتطابق
function rollingSuffix(baseCode, win) {
  let h = 0x811c9dc5;
  const s = `${baseCode}|${win}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return String(h % 100000).padStart(5, '0');
}

// يقبل الرمز الثابت (سوار/ميدالية/بطاقة) أو رمزاً متغيراً من شاشة جوال
// ضمن نافذة ±1 (أي 90 ثانية) تحسّباً لفارق ساعة الجهاز.
function splitCode(raw) {
  const clean = String(raw || '').trim().toUpperCase();
  const m = clean.match(/^(.+)-(\d{5})$/);
  if (!m) return { base: clean, rolling: null };
  return { base: m[1], rolling: m[2] };
}

function rollingValid(base, given) {
  const now = Math.floor(Date.now() / ROLL_WINDOW);
  for (const off of [0, -1, 1]) {
    const expected = rollingSuffix(base, now + off);
    const a = Buffer.from(expected);
    const b = Buffer.from(given);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

function newCode(prefix) {
  // بلا أحرف ملتبسة (0/O، 1/I) — تُقرأ وتُملى بصوت عالٍ عند الحاجة
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) out += alphabet[bytes[i] % alphabet.length];
  return `${prefix}${out}`;
}

// حاضر أم متأخر، بحسب إعداد الدوام في المدرسة
function statusFor(school, now) {
  const lateAfter = school?.late_after || '07:15';
  const [h, m] = String(lateAfter).split(':').map(Number);
  const cutoff = new Date(now);
  cutoff.setHours(h || 7, m || 15, 0, 0);
  return now > cutoff ? 'late' : 'present';
}

async function getSchool(schoolId) {
  const rows = await select(
    `/edu_schools?id=eq.${schoolId}&select=id,name,day_start,late_after&limit=1`
  );
  return rows?.[0] || null;
}

// يسجّل حضور طالب — إعادة المسح لا تُنشئ سجلاً ثانياً
async function markStudent(school, student, method, session, now) {
  const date = todayISO();
  const existing = await select(
    `/edu_attendance?student_id=eq.${student.id}&date=eq.${date}&select=*&limit=1`
  );
  if (existing?.length && existing[0].check_in_at) {
    return { duplicate: true, record: existing[0] };
  }
  const patch = {
    status: statusFor(school, now),
    check_in_at: now.toISOString(),
    method,
    recorded_by: session.id,
  };
  if (existing?.length) {
    const rows = await update('edu_attendance', `id=eq.${existing[0].id}`, patch);
    return { record: rows?.[0] || null };
  }
  const rows = await insert('edu_attendance', [{
    school_id: school.id, student_id: student.id, date, ...patch,
  }]);
  return { record: rows?.[0] || null };
}

async function markStaff(school, user, method, session, now, extra) {
  const date = todayISO();
  const existing = await select(
    `/edu_staff_attendance?user_id=eq.${user.id}&date=eq.${date}&select=*&limit=1`
  );
  const patch = Object.assign({
    status: statusFor(school, now),
    check_in_at: now.toISOString(),
    method,
    recorded_by: session.id,
  }, extra || {});

  if (existing?.length) {
    // من سجّل غيابه من بيته ثم حضر فعلاً: الحضور الفعلي يتجاوز التسجيل الذاتي
    if (existing[0].check_in_at && !extra) return { duplicate: true, record: existing[0] };
    const rows = await update('edu_staff_attendance', `id=eq.${existing[0].id}`, patch);
    return { record: rows?.[0] || null };
  }
  const rows = await insert('edu_staff_attendance', [{
    school_id: school.id, user_id: user.id, date, ...patch,
  }]);
  return { record: rows?.[0] || null };
}

module.exports = async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const session = validateToken(body.token);
  if (!session) return res.status(401).json({ error: 'انتهت الجلسة' });

  const ip = getIp(req);
  const school_id = session.school_id;
  const action = body.action;

  try {
    // ── المنسوب يسجّل نفسه (غائب من بيته، أو حاضر) ─────────────────────
    if (action === 'self') {
      const status = ['absent', 'leave', 'present'].includes(body.status) ? body.status : 'absent';
      const school = await getSchool(school_id);
      if (!school) return res.status(404).json({ error: 'المدرسة غير موجودة' });
      const rows = await select(`/edu_users?id=eq.${session.id}&select=id,full_name&limit=1`);
      if (!rows?.length) return res.status(404).json({ error: 'الحساب غير موجود' });

      const now = new Date();
      const out = await markStaff(school, rows[0], 'self', session, now, {
        status,
        self_report: true,
        reason: String(body.reason || '').trim().slice(0, 300) || null,
        // الغياب المسجّل ذاتياً ليس حضوراً — لا نضع وقت دخول
        check_in_at: status === 'present' ? now.toISOString() : null,
      });
      return res.status(200).json({ ok: true, record: out.record });
    }

    // بقية الإجراءات تخص شاشة الإدارة
    if (!isStaff(session.role)) return res.status(403).json({ error: 'غير مصرح' });

    // ── مسح رمز (باركود أو رقم سري) ────────────────────────────────────
    if (action === 'scan') {
      const { limited } = await rateLimit(`edu-scan:${ip}`, 600, 60 * 1000);
      if (limited) return res.status(429).json({ error: 'طلبات كثيرة' });

      const raw = String(body.code || '').trim();
      if (!raw) return res.status(400).json({ error: 'لا يوجد رمز' });
      const school = await getSchool(school_id);
      if (!school) return res.status(404).json({ error: 'المدرسة غير موجودة' });

      const { base, rolling } = splitCode(raw);
      const enc = encodeURIComponent(q(base));

      // نبحث في الطلاب ثم الكادر — الرمز فريد على مستوى النظام
      let kind = 'student';
      let people = await select(
        `/edu_students?checkin_code=eq.${enc}&school_id=eq.${school_id}&active=is.true` +
        `&select=id,full_name,student_number,class_id,photo_url&limit=1`
      );
      if (!people?.length) {
        kind = 'staff';
        people = await select(
          `/edu_users?checkin_code=eq.${enc}&school_id=eq.${school_id}&active=is.true` +
          `&select=id,full_name,role,avatar_url&limit=1`
        );
      }
      if (!people?.length) return res.status(404).json({ error: 'رمز غير معروف' });
      const person = people[0];

      // رمز شاشة الجوال يجب أن يكون ضمن نافذته الزمنية
      if (rolling && !rollingValid(base, rolling)) {
        return res.status(401).json({ error: 'رمز منتهي — اطلب تحديث الشاشة' });
      }

      const now = new Date();
      const method = rolling ? 'qr' : 'qr';
      const out = kind === 'student'
        ? await markStudent(school, person, method, session, now)
        : await markStaff(school, person, method, session, now);

      let className = null;
      if (kind === 'student' && person.class_id) {
        const c = await select(`/edu_classes?id=eq.${person.class_id}&select=name&limit=1`);
        className = c?.[0]?.name || null;
      }
      return res.status(200).json({
        ok: true, kind, duplicate: !!out.duplicate,
        person: { id: person.id, full_name: person.full_name,
                  student_number: person.student_number || null,
                  class_name: className, role: person.role || null },
        record: out.record,
      });
    }

    // ── رقم سري احتياطي (نسي السوار/البطاقة) ───────────────────────────
    if (action === 'pin') {
      const { limited } = await rateLimit(`edu-pin:${ip}`, 40, 10 * 60 * 1000);
      if (limited) return res.status(429).json({ error: 'محاولات كثيرة' });

      const identifier = String(body.identifier || '').trim();
      const pin = String(body.pin || '').trim();
      if (!identifier || !pin) return res.status(400).json({ error: 'المعرّف أو الرقم السري ناقص' });
      const school = await getSchool(school_id);
      const enc = encodeURIComponent(q(identifier));

      let kind = 'student';
      let people = await select(
        `/edu_students?school_id=eq.${school_id}&active=is.true` +
        `&or=(student_number.eq.${enc},national_id.eq.${enc})` +
        `&select=id,full_name,student_number,class_id,pin_hash&limit=2`
      );
      if (!people?.length) {
        kind = 'staff';
        people = await select(
          `/edu_users?school_id=eq.${school_id}&active=is.true` +
          `&or=(national_id.eq.${enc},phone.eq.${enc},email.eq.${enc})` +
          `&select=id,full_name,role,pin_hash&limit=2`
        );
      }
      // معرّف مكرر → نرفض بدل اختيار شخص عشوائي
      if (!people || people.length !== 1) return res.status(404).json({ error: 'لم يُعثر على الشخص' });
      const person = people[0];

      const { valid } = verifyPassword(pin, person.pin_hash || 'scrypt:00:00');
      if (!valid) return res.status(401).json({ error: 'الرقم السري غير صحيح' });

      const now = new Date();
      const out = kind === 'student'
        ? await markStudent(school, person, 'pin', session, now)
        : await markStaff(school, person, 'pin', session, now);
      return res.status(200).json({
        ok: true, kind, duplicate: !!out.duplicate,
        person: { id: person.id, full_name: person.full_name,
                  student_number: person.student_number || null, role: person.role || null },
        record: out.record,
      });
    }

    // ── بحث الإدارة (نسي كل شيء) ───────────────────────────────────────
    if (action === 'lookup') {
      const term = String(body.q || '').trim();
      if (term.length < 2) return res.status(400).json({ error: 'اكتب حرفين على الأقل' });
      const enc = encodeURIComponent(`*${q(term).slice(1, -1)}*`);
      const eq = encodeURIComponent(q(term));

      const [students, staff] = await Promise.all([
        select(`/edu_students?school_id=eq.${school_id}&active=is.true` +
          `&or=(full_name.ilike.${enc},student_number.eq.${eq},national_id.eq.${eq})` +
          `&select=id,full_name,student_number,class_id&limit=15`),
        select(`/edu_users?school_id=eq.${school_id}&active=is.true&role=in.(teacher,school_admin)` +
          `&or=(full_name.ilike.${enc},national_id.eq.${eq},phone.eq.${eq})` +
          `&select=id,full_name,role&limit=15`),
      ]);
      const classes = await select(`/edu_classes?school_id=eq.${school_id}&select=id,name`);
      const byId = Object.fromEntries(classes.map((c) => [c.id, c.name]));
      return res.status(200).json({
        students: students.map((s) => ({ ...s, class_name: byId[s.class_id] || null })),
        staff,
      });
    }

    // ── تسجيل يدوي بعد البحث ───────────────────────────────────────────
    if (action === 'manual') {
      const kind = body.kind === 'staff' ? 'staff' : 'student';
      if (!body.id) return res.status(400).json({ error: 'المعرّف ناقص' });
      const school = await getSchool(school_id);
      const rows = kind === 'student'
        ? await select(`/edu_students?id=eq.${body.id}&school_id=eq.${school_id}&select=id,full_name,student_number&limit=1`)
        : await select(`/edu_users?id=eq.${body.id}&school_id=eq.${school_id}&select=id,full_name,role&limit=1`);
      if (!rows?.length) return res.status(404).json({ error: 'غير موجود' });

      const now = new Date();
      const out = kind === 'student'
        ? await markStudent(school, rows[0], 'manual', session, now)
        : await markStaff(school, rows[0], 'manual', session, now);
      return res.status(200).json({
        ok: true, kind, duplicate: !!out.duplicate,
        person: rows[0], record: out.record,
      });
    }

    // ── سجل اليوم المباشر + من لم يحضر بعد ─────────────────────────────
    if (action === 'feed') {
      const date = todayISO();
      const [studentRows, staffRows, allStudents, allStaff] = await Promise.all([
        select(`/edu_attendance?school_id=eq.${school_id}&date=eq.${date}&check_in_at=not.is.null` +
          `&select=*&order=check_in_at.desc&limit=60`),
        select(`/edu_staff_attendance?school_id=eq.${school_id}&date=eq.${date}` +
          `&select=*&order=check_in_at.desc.nullslast&limit=200`),
        select(`/edu_students?school_id=eq.${school_id}&active=is.true&select=id,full_name,student_number,class_id`),
        select(`/edu_users?school_id=eq.${school_id}&active=is.true&role=in.(teacher,school_admin)&select=id,full_name,role`),
      ]);
      const sById = Object.fromEntries(allStudents.map((s) => [s.id, s]));
      const uById = Object.fromEntries(allStaff.map((u) => [u.id, u]));
      const classes = await select(`/edu_classes?school_id=eq.${school_id}&select=id,name`);
      const cById = Object.fromEntries(classes.map((c) => [c.id, c.name]));

      const arrived = new Set(studentRows.map((r) => r.student_id));
      const staffSeen = Object.fromEntries(staffRows.map((r) => [r.user_id, r]));

      return res.status(200).json({
        date,
        recent: studentRows.slice(0, 25).map((r) => ({
          kind: 'student', id: r.student_id,
          full_name: sById[r.student_id]?.full_name || '—',
          detail: cById[sById[r.student_id]?.class_id] || '',
          status: r.status, method: r.method, at: r.check_in_at,
        })).concat(staffRows.filter((r) => r.check_in_at).slice(0, 15).map((r) => ({
          kind: 'staff', id: r.user_id,
          full_name: uById[r.user_id]?.full_name || '—',
          detail: uById[r.user_id]?.role === 'school_admin' ? 'الإدارة' : 'معلم',
          status: r.status, method: r.method, at: r.check_in_at,
        }))).sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, 30),
        summary: {
          students_total: allStudents.length,
          students_in: arrived.size,
          students_missing: allStudents.length - arrived.size,
          staff_total: allStaff.length,
          staff_in: staffRows.filter((r) => r.check_in_at).length,
          staff_absent: staffRows.filter((r) => r.status === 'absent' || r.status === 'leave').length,
        },
        // من سجّل غيابه من بيته — الإدارة تحتاجها فوراً لتدبير الاحتياط
        staff_absent: staffRows
          .filter((r) => r.status === 'absent' || r.status === 'leave')
          .map((r) => ({
            user_id: r.user_id, full_name: uById[r.user_id]?.full_name || '—',
            status: r.status, reason: r.reason, self_report: r.self_report,
          })),
        staff_pending: allStaff.filter((u) => !staffSeen[u.id])
          .map((u) => ({ id: u.id, full_name: u.full_name })),
      });
    }

    // ── توليد رموز الحضور لمن لا رمز له ────────────────────────────────
    if (action === 'issue_codes') {
      if (session.role !== 'school_admin') {
        return res.status(403).json({ error: 'يقتصر على إدارة المدرسة' });
      }
      const [students, staff] = await Promise.all([
        select(`/edu_students?school_id=eq.${school_id}&active=is.true&checkin_code=is.null&select=id&limit=1000`),
        select(`/edu_users?school_id=eq.${school_id}&active=is.true&checkin_code=is.null&select=id&limit=500`),
      ]);
      for (const s of students) {
        await update('edu_students', `id=eq.${s.id}`, { checkin_code: newCode('S') });
      }
      for (const u of staff) {
        await update('edu_users', `id=eq.${u.id}`, { checkin_code: newCode('T') });
      }
      return res.status(200).json({ ok: true, students: students.length, staff: staff.length });
    }

    // ── ضبط الرقم السري الاحتياطي ──────────────────────────────────────
    if (action === 'set_pin') {
      const pin = String(body.pin || '').trim();
      if (!/^\d{4,8}$/.test(pin)) {
        return res.status(400).json({ error: 'الرقم السري من 4 إلى 8 أرقام' });
      }
      const kind = body.kind === 'staff' ? 'staff' : 'student';
      if (!body.id) return res.status(400).json({ error: 'المعرّف ناقص' });
      const table = kind === 'student' ? 'edu_students' : 'edu_users';
      const rows = await update(table, `id=eq.${body.id}&school_id=eq.${school_id}`,
        { pin_hash: hashPassword(pin) });
      if (!rows?.length) return res.status(404).json({ error: 'غير موجود' });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'إجراء غير معروف' });
  } catch (e) {
    console.error('edu-checkin error:', e.message);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
};
