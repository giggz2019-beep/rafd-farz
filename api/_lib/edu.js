'use strict';
// رفد تعليم — أدوات مشتركة بين api/edu-auth.js و api/edu-data.js
// مجلد يبدأ بـ _ حتى لا تعامله Vercel كمسار (route).
const crypto = require('crypto');

const SB_URL = process.env.SUPABASE_URL || 'https://ycnnawohrbbluawxzttt.supabase.co';

// صلاحية جلسة ولي الأمر/الطالب أطول من جلسة الشريك — الاستخدام يومي وسريع
const SESSION_MS = 12 * 60 * 60 * 1000; // 12 ساعة

function secret() {
  const s = process.env.EDU_SECRET || process.env.PARTNER_SECRET || process.env.SUPABASE_SERVICE_KEY;
  if (!s) throw new Error('EDU_SECRET not configured');
  return s;
}

function serviceKey() {
  const k = process.env.SUPABASE_SERVICE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_KEY not configured');
  return k;
}

// ── الجلسة: توقيع HMAC على (userId|role|schoolId|ts) ─────────────────────────
function issueToken(user) {
  const ts = Date.now().toString();
  const payload = `${user.id}|${user.role}|${user.school_id}|${ts}`;
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('hex');
  return Buffer.from(`${payload}|${sig}`).toString('base64url');
}

function validateToken(token) {
  try {
    if (!token || typeof token !== 'string') return null;
    const decoded = Buffer.from(token, 'base64url').toString();
    const parts = decoded.split('|');
    if (parts.length !== 5) return null;
    const [id, role, school_id, ts, sig] = parts;
    if (Date.now() - parseInt(ts, 10) > SESSION_MS) return null;
    const expected = crypto
      .createHmac('sha256', secret())
      .update(`${id}|${role}|${school_id}|${ts}`)
      .digest('hex');
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return { id, role, school_id };
  } catch {
    return null;
  }
}

// ── Supabase REST ────────────────────────────────────────────────────────────
async function sb(method, path, body) {
  const key = serviceKey();
  const r = await fetch(`${SB_URL}/rest/v1${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`DB ${r.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const select = (path) => sb('GET', path);
const insert = (table, rows) => sb('POST', `/${table}`, rows);
const update = (table, filter, patch) => sb('PATCH', `/${table}?${filter}`, patch);
const remove = (table, filter) => sb('DELETE', `/${table}?${filter}`);

// ── مساعدات ─────────────────────────────────────────────────────────────────
// PostgREST يفسّر بعض الرموز (, . ( ) :) داخل قيم المرشّحات — نغلّفها باقتباس
// مزدوج ونهرب ما بداخلها حتى لا يتسرب مُدخل مستخدم إلى بناء الاستعلام.
function q(value) {
  return `"${String(value).replace(/[\\"]/g, (m) => `\\${m}`)}"`;
}

function inList(values) {
  return `(${values.map(q).join(',')})`;
}

function cors(req, res, methods = 'POST, OPTIONS') {
  const origin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  if (origin !== '*') res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

// كل الأدوار المسموح لها بالكتابة الإدارية
const STAFF = ['school_admin', 'teacher'];

function isStaff(role) {
  return STAFF.includes(role);
}

// قائمة معرّفات الطلاب التي يحق للمستخدم الاطلاع عليها.
// ولي الأمر: أبناؤه فقط. الطالب: نفسه فقط. الكادر: كل طلاب المدرسة.
async function visibleStudentIds(session) {
  if (isStaff(session.role)) {
    const rows = await select(
      `/edu_students?school_id=eq.${session.school_id}&select=id`
    );
    return rows.map((r) => r.id);
  }
  if (session.role === 'parent') {
    const rows = await select(
      `/edu_guardians?parent_user_id=eq.${session.id}&school_id=eq.${session.school_id}&select=student_id`
    );
    return rows.map((r) => r.student_id);
  }
  if (session.role === 'student') {
    const rows = await select(
      `/edu_students?user_id=eq.${session.id}&school_id=eq.${session.school_id}&select=id`
    );
    return rows.map((r) => r.id);
  }
  return [];
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

module.exports = {
  SB_URL,
  SESSION_MS,
  secret,
  serviceKey,
  issueToken,
  validateToken,
  sb,
  select,
  insert,
  update,
  remove,
  q,
  inList,
  cors,
  STAFF,
  isStaff,
  visibleStudentIds,
  todayISO,
  addDaysISO,
};
