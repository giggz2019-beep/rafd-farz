'use strict';
// رفد تعليم — كل عمليات البيانات المُصادَق عليها.
// كل طلب يجب أن يحمل { token } صالحاً، والصلاحية تُحسم على الخادم:
//   parent  → أبناؤه فقط        student → نفسه فقط
//   teacher / school_admin → نطاق مدرسته فقط (لا يمكن تجاوز school_id أبداً)
const {
  select, insert, update, remove, q, inList, cors,
  validateToken, isStaff, visibleStudentIds, todayISO, addDaysISO,
} = require('./_lib/edu');
const { rateLimit, getIp } = require('./_lib/rate-limit');

// جداول يُسمح للكادر بالكتابة فيها، مع الحقول المسموح بها لكل جدول.
// أي حقل خارج القائمة يُحذف بصمت — لا يستطيع العميل تمرير school_id مثلاً.
const WRITABLE = {
  edu_classes: ['name', 'grade_level', 'section', 'academic_year', 'homeroom_teacher_id'],
  edu_subjects: ['name', 'name_en', 'code', 'color'],
  edu_students: ['user_id', 'class_id', 'full_name', 'student_number', 'national_id', 'birth_date', 'gender', 'photo_url', 'active'],
  edu_guardians: ['parent_user_id', 'student_id', 'relation', 'is_primary'],
  edu_timetable: ['class_id', 'subject_id', 'teacher_id', 'weekday', 'period_no', 'start_time', 'end_time', 'room'],
  edu_exams: ['class_id', 'subject_id', 'teacher_id', 'title', 'exam_type', 'exam_date', 'start_time', 'duration_min', 'max_score', 'location', 'topics', 'notes'],
  edu_grades: ['student_id', 'subject_id', 'exam_id', 'term', 'kind', 'title', 'score', 'max_score', 'weight', 'teacher_note', 'published'],
  edu_homework: ['class_id', 'subject_id', 'teacher_id', 'title', 'description', 'assigned_date', 'due_date', 'attachment_url', 'max_score'],
  edu_homework_status: ['homework_id', 'student_id', 'status', 'submitted_at', 'score', 'feedback'],
  edu_attendance: ['student_id', 'date', 'status', 'note'],
  edu_announcements: ['class_id', 'title', 'body', 'audience', 'pinned'],
};

function pick(table, payload) {
  const allowed = WRITABLE[table];
  if (!allowed) return null;
  const out = {};
  for (const k of allowed) {
    if (payload[k] !== undefined) out[k] = payload[k] === '' ? null : payload[k];
  }
  return out;
}

// يتحقق أن الطالب المطلوب ضمن نطاق المستخدم، ويعيد معرّفه أو null
async function resolveStudent(session, studentId) {
  const allowed = await visibleStudentIds(session);
  if (!allowed.length) return null;
  if (!studentId) return allowed[0];
  return allowed.includes(studentId) ? studentId : null;
}

async function studentRow(studentId) {
  const rows = await select(
    `/edu_students?id=eq.${studentId}&select=id,full_name,student_number,photo_url,class_id,school_id&limit=1`
  );
  return rows?.[0] || null;
}

// خرائط مساعدة لتحويل المعرّفات إلى أسماء (المواد والمعلمون والفصول)
async function lookups(schoolId) {
  const [subjects, teachers, classes] = await Promise.all([
    select(`/edu_subjects?school_id=eq.${schoolId}&select=id,name,name_en,color`),
    select(`/edu_users?school_id=eq.${schoolId}&role=in.(teacher,school_admin)&select=id,full_name`),
    select(`/edu_classes?school_id=eq.${schoolId}&select=id,name,grade_level,section`),
  ]);
  const map = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));
  return { subjects: map(subjects), teachers: map(teachers), classes: map(classes),
           subjectList: subjects, teacherList: teachers, classList: classes };
}

function decorate(rows, lk) {
  return rows.map((r) => ({
    ...r,
    subject_name: lk.subjects[r.subject_id]?.name || null,
    subject_color: lk.subjects[r.subject_id]?.color || null,
    teacher_name: lk.teachers[r.teacher_id]?.full_name || null,
    class_name: lk.classes[r.class_id]?.name || null,
  }));
}

// ── قراءات خاصة بطالب واحد ──────────────────────────────────────────────────
async function childTimetable(student, lk) {
  if (!student.class_id) return [];
  const rows = await select(
    `/edu_timetable?class_id=eq.${student.class_id}&select=*&order=weekday.asc,period_no.asc`
  );
  return decorate(rows, lk);
}

async function childExams(student, lk, { from, to } = {}) {
  if (!student.class_id) return [];
  const f = from || addDaysISO(-30);
  const t = to || addDaysISO(120);
  const rows = await select(
    `/edu_exams?class_id=eq.${student.class_id}&exam_date=gte.${f}&exam_date=lte.${t}&select=*&order=exam_date.asc`
  );
  return decorate(rows, lk);
}

async function childHomework(student, lk) {
  if (!student.class_id) return [];
  const rows = await select(
    `/edu_homework?class_id=eq.${student.class_id}&due_date=gte.${addDaysISO(-30)}&select=*&order=due_date.asc`
  );
  if (!rows.length) return [];
  const statuses = await select(
    `/edu_homework_status?student_id=eq.${student.id}&homework_id=in.${inList(rows.map((r) => r.id))}&select=*`
  );
  const byHw = Object.fromEntries(statuses.map((s) => [s.homework_id, s]));
  const today = todayISO();
  return decorate(rows, lk).map((hw) => {
    const st = byHw[hw.id];
    let status = st?.status || 'pending';
    // واجب لم يُسلَّم وتجاوز موعده = متأخر (يُحتسب عند العرض، لا يُخزَّن)
    if (status === 'pending' && hw.due_date < today) status = 'late';
    return { ...hw, status, score: st?.score ?? null, feedback: st?.feedback || null,
             submitted_at: st?.submitted_at || null };
  });
}

async function childGrades(student, lk, term) {
  const termFilter = term ? `&term=eq.${encodeURIComponent(q(term))}` : '';
  const rows = await select(
    `/edu_grades?student_id=eq.${student.id}&published=is.true${termFilter}&select=*&order=created_at.desc&limit=300`
  );
  return decorate(rows, lk);
}

async function childAttendance(student, { from, to } = {}) {
  const f = from || addDaysISO(-120);
  const t = to || todayISO();
  return select(
    `/edu_attendance?student_id=eq.${student.id}&date=gte.${f}&date=lte.${t}&select=*&order=date.desc`
  );
}

// متوسط الطالب الموزون لكل مادة + المتوسط العام
function summarizeGrades(grades) {
  const bySubject = {};
  for (const g of grades) {
    if (g.score == null || !g.max_score) continue;
    const key = g.subject_id || 'other';
    if (!bySubject[key]) {
      bySubject[key] = { subject_id: g.subject_id, subject_name: g.subject_name || 'عام',
                         subject_color: g.subject_color, weighted: 0, weight: 0, count: 0 };
    }
    const pct = (Number(g.score) / Number(g.max_score)) * 100;
    const w = Number(g.weight) || 1;
    bySubject[key].weighted += pct * w;
    bySubject[key].weight += w;
    bySubject[key].count += 1;
  }
  const subjects = Object.values(bySubject).map((s) => ({
    subject_id: s.subject_id,
    subject_name: s.subject_name,
    subject_color: s.subject_color,
    count: s.count,
    average: s.weight ? Math.round((s.weighted / s.weight) * 10) / 10 : null,
  }));
  const withAvg = subjects.filter((s) => s.average != null);
  const overall = withAvg.length
    ? Math.round((withAvg.reduce((a, s) => a + s.average, 0) / withAvg.length) * 10) / 10
    : null;
  return { subjects, overall };
}

function summarizeAttendance(rows) {
  const counts = { present: 0, absent: 0, late: 0, excused: 0 };
  for (const r of rows) if (counts[r.status] !== undefined) counts[r.status] += 1;
  const total = rows.length;
  return { ...counts, total, rate: total ? Math.round((counts.present / total) * 1000) / 10 : null };
}

module.exports = async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const session = validateToken(body.token);
  if (!session) return res.status(401).json({ error: 'انتهت الجلسة' });

  const { limited } = await rateLimit(`edu-data:${getIp(req)}`, 240, 60 * 1000);
  if (limited) return res.status(429).json({ error: 'طلبات كثيرة. حاول بعد قليل.' });

  const action = body.action;
  const school = session.school_id;

  try {
    const lk = await lookups(school);

    // ═══ 1. نظرة عامة (الشاشة الرئيسية لكل دور) ══════════════════════════
    if (action === 'overview') {
      // ── ولي الأمر / الطالب ───────────────────────────────────────────
      if (session.role === 'parent' || session.role === 'student') {
        const ids = await visibleStudentIds(session);
        if (!ids.length) return res.status(200).json({ children: [], active: null });

        const students = await select(
          `/edu_students?id=in.${inList(ids)}&select=id,full_name,student_number,photo_url,class_id&order=full_name.asc`
        );
        const children = students.map((s) => ({ ...s, class_name: lk.classes[s.class_id]?.name || null }));

        const activeId = (body.student_id && ids.includes(body.student_id)) ? body.student_id : ids[0];
        const student = students.find((s) => s.id === activeId) || students[0];

        const [timetable, exams, homework, grades, attendance, announcements] = await Promise.all([
          childTimetable(student, lk),
          childExams(student, lk, { from: todayISO(), to: addDaysISO(60) }),
          childHomework(student, lk),
          childGrades(student, lk),
          childAttendance(student, { from: addDaysISO(-60) }),
          select(
            `/edu_announcements?school_id=eq.${school}&or=(class_id.is.null,class_id.eq.${student.class_id || '00000000-0000-0000-0000-000000000000'})&select=*&order=pinned.desc,created_at.desc&limit=15`
          ),
        ]);

        const weekday = new Date().getDay(); // 0 = الأحد
        return res.status(200).json({
          children,
          active: { ...student, class_name: lk.classes[student.class_id]?.name || null },
          today: timetable.filter((t) => t.weekday === weekday),
          timetable,
          exams,
          homework,
          homework_due: homework.filter((h) => h.status === 'pending' || h.status === 'late'),
          grades: grades.slice(0, 20),
          grade_summary: summarizeGrades(grades),
          attendance_summary: summarizeAttendance(attendance),
          announcements,
        });
      }

      // ── الكادر (إدارة / معلم) ────────────────────────────────────────
      if (isStaff(session.role)) {
        const [students, exams, homework, announcements, attToday] = await Promise.all([
          select(`/edu_students?school_id=eq.${school}&active=is.true&select=id,class_id`),
          select(`/edu_exams?school_id=eq.${school}&exam_date=gte.${todayISO()}&select=*&order=exam_date.asc&limit=25`),
          select(`/edu_homework?school_id=eq.${school}&due_date=gte.${todayISO()}&select=*&order=due_date.asc&limit=25`),
          select(`/edu_announcements?school_id=eq.${school}&select=*&order=pinned.desc,created_at.desc&limit=15`),
          select(`/edu_attendance?school_id=eq.${school}&date=eq.${todayISO()}&select=status`),
        ]);
        return res.status(200).json({
          stats: {
            students: students.length,
            classes: lk.classList.length,
            subjects: lk.subjectList.length,
            teachers: lk.teacherList.length,
            attendance_today: summarizeAttendance(attToday),
          },
          classes: lk.classList,
          subjects: lk.subjectList,
          teachers: lk.teacherList,
          exams: decorate(exams, lk),
          homework: decorate(homework, lk),
          announcements,
        });
      }
      return res.status(403).json({ error: 'غير مصرح' });
    }

    // ═══ 2. قراءات تفصيلية لطالب ═══════════════════════════════════════
    if (['timetable', 'exams', 'grades', 'homework', 'attendance', 'student_profile'].includes(action)) {
      const sid = await resolveStudent(session, body.student_id);
      if (!sid) return res.status(403).json({ error: 'غير مصرح بالوصول لهذا الطالب' });
      const student = await studentRow(sid);
      if (!student) return res.status(404).json({ error: 'الطالب غير موجود' });

      if (action === 'timetable') return res.status(200).json({ timetable: await childTimetable(student, lk) });
      if (action === 'exams') {
        return res.status(200).json({ exams: await childExams(student, lk, { from: body.from, to: body.to }) });
      }
      if (action === 'homework') return res.status(200).json({ homework: await childHomework(student, lk) });
      if (action === 'grades') {
        const grades = await childGrades(student, lk, body.term);
        return res.status(200).json({ grades, summary: summarizeGrades(grades) });
      }
      if (action === 'attendance') {
        const rows = await childAttendance(student, { from: body.from, to: body.to });
        return res.status(200).json({ attendance: rows, summary: summarizeAttendance(rows) });
      }
      if (action === 'student_profile') {
        return res.status(200).json({ student: { ...student, class_name: lk.classes[student.class_id]?.name || null } });
      }
    }

    // ═══ 3. الإعلانات ══════════════════════════════════════════════════
    if (action === 'announcements') {
      const rows = await select(
        `/edu_announcements?school_id=eq.${school}&select=*&order=pinned.desc,created_at.desc&limit=50`
      );
      return res.status(200).json({ announcements: rows });
    }

    // ═══ 4. المراسلات ══════════════════════════════════════════════════
    if (action === 'messages') {
      const rows = await select(
        `/edu_messages?school_id=eq.${school}&or=(from_user_id.eq.${session.id},to_user_id.eq.${session.id})&select=*&order=created_at.asc&limit=300`
      );
      const userIds = [...new Set(rows.flatMap((m) => [m.from_user_id, m.to_user_id]))];
      const people = userIds.length
        ? await select(`/edu_users?id=in.${inList(userIds)}&select=id,full_name,role,avatar_url`)
        : [];
      // جهات يمكن مراسلتها: الكادر فقط (لا مراسلة بين أولياء الأمور)
      const contacts = await select(
        `/edu_users?school_id=eq.${school}&role=in.(teacher,school_admin)&active=is.true&select=id,full_name,role,avatar_url&order=full_name.asc`
      );
      // تعليم الوارد كمقروء
      await update('edu_messages', `to_user_id=eq.${session.id}&read_at=is.null`, { read_at: new Date().toISOString() })
        .catch(() => {});
      return res.status(200).json({ messages: rows, people, contacts });
    }

    if (action === 'send_message') {
      const to = String(body.to_user_id || '');
      const text = String(body.body || '').trim();
      if (!to || !text) return res.status(400).json({ error: 'الرسالة أو المستلم ناقص' });
      if (text.length > 2000) return res.status(400).json({ error: 'الرسالة طويلة جداً' });

      // المستلم يجب أن يكون في نفس المدرسة
      const recipient = await select(`/edu_users?id=eq.${to}&school_id=eq.${school}&select=id,role&limit=1`);
      if (!recipient?.length) return res.status(403).json({ error: 'المستلم غير موجود' });
      // ولي الأمر والطالب يراسلان الكادر فقط
      if (!isStaff(session.role) && !isStaff(recipient[0].role)) {
        return res.status(403).json({ error: 'يمكن مراسلة الكادر التعليمي فقط' });
      }
      let sid = null;
      if (body.student_id) {
        sid = await resolveStudent(session, body.student_id);
        if (!sid) return res.status(403).json({ error: 'غير مصرح بالوصول لهذا الطالب' });
      }
      const rows = await insert('edu_messages', [{
        school_id: school, student_id: sid, from_user_id: session.id, to_user_id: to, body: text,
      }]);
      return res.status(200).json({ message: rows?.[0] || null });
    }

    // ═══ 5. الطالب يعلّم واجبه كمُسلَّم ════════════════════════════════
    if (action === 'submit_homework') {
      if (session.role !== 'student' && session.role !== 'parent') {
        return res.status(403).json({ error: 'غير مصرح' });
      }
      const sid = await resolveStudent(session, body.student_id);
      if (!sid) return res.status(403).json({ error: 'غير مصرح بالوصول لهذا الطالب' });
      const student = await studentRow(sid);
      const hw = await select(
        `/edu_homework?id=eq.${body.homework_id}&school_id=eq.${school}&select=id,class_id&limit=1`
      );
      if (!hw?.length || hw[0].class_id !== student.class_id) {
        return res.status(403).json({ error: 'الواجب غير متاح لهذا الطالب' });
      }
      const existing = await select(
        `/edu_homework_status?homework_id=eq.${body.homework_id}&student_id=eq.${sid}&select=id&limit=1`
      );
      const patch = { status: 'submitted', submitted_at: new Date().toISOString() };
      if (existing?.length) {
        await update('edu_homework_status', `id=eq.${existing[0].id}`, patch);
      } else {
        await insert('edu_homework_status', [{
          school_id: school, homework_id: body.homework_id, student_id: sid, ...patch,
        }]);
      }
      return res.status(200).json({ ok: true });
    }

    // ═══ 6. عمليات الكادر (إنشاء/تعديل/حذف) ════════════════════════════
    if (action === 'save' || action === 'delete') {
      if (!isStaff(session.role)) return res.status(403).json({ error: 'غير مصرح' });
      const table = String(body.table || '');
      if (!WRITABLE[table]) return res.status(400).json({ error: 'جدول غير مسموح' });

      if (action === 'delete') {
        if (!body.id) return res.status(400).json({ error: 'المعرّف ناقص' });
        // school_id في الفلتر يمنع حذف صف يخص مدرسة أخرى
        await remove(table, `id=eq.${body.id}&school_id=eq.${school}`);
        return res.status(200).json({ ok: true });
      }

      const patch = pick(table, body.data || {});
      if (!patch || !Object.keys(patch).length) {
        return res.status(400).json({ error: 'لا توجد بيانات للحفظ' });
      }
      if (body.id) {
        const rows = await update(table, `id=eq.${body.id}&school_id=eq.${school}`, patch);
        if (!rows?.length) return res.status(404).json({ error: 'السجل غير موجود' });
        return res.status(200).json({ row: rows[0] });
      }
      const rows = await insert(table, [{ ...patch, school_id: school,
        ...(table === 'edu_announcements' || table === 'edu_grades' ? { created_by: session.id } : {}),
        ...(table === 'edu_attendance' ? { recorded_by: session.id } : {}) }]);
      return res.status(200).json({ row: rows?.[0] || null });
    }

    // ═══ 7. قوائم الكادر ═══════════════════════════════════════════════
    if (action === 'roster') {
      if (!isStaff(session.role)) return res.status(403).json({ error: 'غير مصرح' });
      const classFilter = body.class_id ? `&class_id=eq.${body.class_id}` : '';
      const students = await select(
        `/edu_students?school_id=eq.${school}&active=is.true${classFilter}&select=*&order=full_name.asc`
      );
      return res.status(200).json({
        students: students.map((s) => ({ ...s, class_name: lk.classes[s.class_id]?.name || null })),
        classes: lk.classList, subjects: lk.subjectList, teachers: lk.teacherList,
      });
    }

    if (action === 'class_detail') {
      if (!isStaff(session.role)) return res.status(403).json({ error: 'غير مصرح' });
      if (!body.class_id) return res.status(400).json({ error: 'الفصل ناقص' });
      const [students, timetable, exams, homework] = await Promise.all([
        select(`/edu_students?school_id=eq.${school}&class_id=eq.${body.class_id}&active=is.true&select=*&order=full_name.asc`),
        select(`/edu_timetable?school_id=eq.${school}&class_id=eq.${body.class_id}&select=*&order=weekday.asc,period_no.asc`),
        select(`/edu_exams?school_id=eq.${school}&class_id=eq.${body.class_id}&select=*&order=exam_date.desc&limit=50`),
        select(`/edu_homework?school_id=eq.${school}&class_id=eq.${body.class_id}&select=*&order=due_date.desc&limit=50`),
      ]);
      return res.status(200).json({
        students, timetable: decorate(timetable, lk),
        exams: decorate(exams, lk), homework: decorate(homework, lk),
      });
    }

    return res.status(400).json({ error: 'إجراء غير معروف' });
  } catch (e) {
    console.error('edu-data error:', e.message);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
};
