/* ============================================================
   رفد تعليم — المكتبة المشتركة لبوابات ولي الأمر والطالب والمدرسة
   - إدارة الجلسة (localStorage)
   - استدعاء api/edu-auth.js و api/edu-data.js
   - وضع تجريبي كامل يعمل بدون قاعدة بيانات (لعرض المنصة فوراً)
   - أدوات عرض: تواريخ عربية، أيام الأسبوع، شارات، تنبيهات
   ============================================================ */
(function (global) {
  'use strict';

  var SESSION_KEY = 'rafdEduSession';
  var DEMO_KEY = 'rafdEduDemo';

  // ── الجلسة ────────────────────────────────────────────────────────────
  function getSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || !s.user) return null;
      if (s.expires && Date.now() > s.expires) { clearSession(); return null; }
      return s;
    } catch (e) { return null; }
  }

  function setSession(session) {
    // الجلسة الحقيقية صالحة 12 ساعة (مطابقة لـ SESSION_MS في api/_lib/edu.js)
    session.expires = Date.now() + 12 * 60 * 60 * 1000;
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(DEMO_KEY);
  }

  function isDemo() {
    var s = getSession();
    return !!(s && s.demo);
  }

  // يحرس الصفحة: يحوّل لصفحة الدخول إذا لم توجد جلسة أو كان الدور غير مسموح
  function requireRole(roles) {
    var s = getSession();
    if (!s) { location.href = '/edu-login.html'; return null; }
    if (roles && roles.indexOf(s.user.role) === -1) {
      location.href = homeFor(s.user.role);
      return null;
    }
    return s;
  }

  function homeFor(role) {
    if (role === 'parent') return '/edu-parent.html';
    if (role === 'student') return '/edu-student.html';
    return '/edu-school.html';
  }

  // ── استدعاء الـ API ──────────────────────────────────────────────────
  async function callApi(endpoint, payload) {
    var r = await fetch('/api/' + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok) {
      var err = new Error(data.error || 'تعذّر تنفيذ الطلب');
      err.status = r.status;
      throw err;
    }
    return data;
  }

  // كل قراءات/كتابات البيانات تمر من هنا. في الوضع التجريبي تُخدَم محلياً.
  async function data(action, payload) {
    var s = getSession();
    if (!s) throw new Error('انتهت الجلسة');
    if (s.demo) return Demo.handle(action, payload || {}, s);
    try {
      return await callApi('edu-data', Object.assign({ action: action, token: s.token }, payload || {}));
    } catch (e) {
      if (e.status === 401) { clearSession(); location.href = '/edu-login.html'; }
      throw e;
    }
  }

  // ── أدوات التاريخ والعرض ─────────────────────────────────────────────
  var WEEKDAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  var WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  // الأسبوع الدراسي السعودي: الأحد → الخميس
  var SCHOOL_DAYS = [0, 1, 2, 3, 4];

  function lang() {
    try { return localStorage.getItem('rafdLang') || 'ar'; } catch (e) { return 'ar'; }
  }

  function weekdayName(i) {
    return lang() === 'en' ? WEEKDAYS_EN[i] : WEEKDAYS_AR[i];
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(lang() === 'en' ? 'en-GB' : 'ar-SA-u-ca-gregory',
      { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function fmtShort(iso) {
    if (!iso) return '—';
    var d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(lang() === 'en' ? 'en-GB' : 'ar-SA-u-ca-gregory',
      { day: 'numeric', month: 'short' });
  }

  function fmtTime(t) {
    if (!t) return '';
    var parts = String(t).split(':');
    var h = parseInt(parts[0], 10);
    var m = parts[1] || '00';
    if (isNaN(h)) return t;
    var suffix = h < 12 ? (lang() === 'en' ? 'AM' : 'ص') : (lang() === 'en' ? 'PM' : 'م');
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ':' + m + ' ' + suffix;
  }

  // "بعد 3 أيام" / "متأخر بيومين"
  function daysUntil(iso) {
    if (!iso) return null;
    var target = new Date(iso + 'T00:00:00');
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((target - today) / 86400000);
  }

  function relativeDay(iso) {
    var n = daysUntil(iso);
    if (n === null) return '';
    var en = lang() === 'en';
    if (n === 0) return en ? 'Today' : 'اليوم';
    if (n === 1) return en ? 'Tomorrow' : 'غداً';
    if (n === -1) return en ? 'Yesterday' : 'أمس';
    if (n > 0) return en ? ('In ' + n + ' days') : ('بعد ' + n + ' أيام');
    return en ? (Math.abs(n) + ' days ago') : ('قبل ' + Math.abs(n) + ' أيام');
  }

  function initials(name) {
    if (!name) return '؟';
    var parts = String(name).trim().split(/\s+/);
    return parts.length > 1 ? (parts[0][0] + parts[1][0]) : parts[0].slice(0, 2);
  }

  function pct(score, max) {
    if (score == null || !max) return null;
    return Math.round((Number(score) / Number(max)) * 1000) / 10;
  }

  // لون/شارة حسب النسبة المئوية
  function gradeTone(p) {
    if (p == null) return 'neutral';
    if (p >= 85) return 'ok';
    if (p >= 70) return 'info';
    if (p >= 60) return 'warn';
    return 'danger';
  }

  var HW_LABELS = {
    pending:   { ar: 'لم يُسلَّم',  en: 'Not submitted', tone: 'warn' },
    submitted: { ar: 'تم التسليم',  en: 'Submitted',     tone: 'ok' },
    late:      { ar: 'متأخر',       en: 'Late',          tone: 'danger' },
    graded:    { ar: 'مُصحّح',      en: 'Graded',        tone: 'info' },
  };

  var ATT_LABELS = {
    present: { ar: 'حاضر',        en: 'Present', tone: 'ok' },
    absent:  { ar: 'غائب',        en: 'Absent',  tone: 'danger' },
    late:    { ar: 'متأخر',       en: 'Late',    tone: 'warn' },
    excused: { ar: 'غياب بعذر',   en: 'Excused', tone: 'info' },
  };

  var EXAM_LABELS = {
    quiz:    { ar: 'اختبار قصير', en: 'Quiz' },
    midterm: { ar: 'اختبار فترة', en: 'Midterm' },
    final:   { ar: 'اختبار نهائي', en: 'Final' },
  };

  var INV_LABELS = {
    paid:      { ar: 'مسدَّد',        en: 'Paid',      tone: 'ok' },
    partial:   { ar: 'مدفوع جزئياً',  en: 'Partial',   tone: 'warn' },
    unpaid:    { ar: 'غير مسدَّد',    en: 'Unpaid',    tone: 'neutral' },
    overdue:   { ar: 'متأخر',         en: 'Overdue',   tone: 'danger' },
    cancelled: { ar: 'ملغاة',         en: 'Cancelled', tone: 'neutral' },
  };

  var PAY_LABELS = {
    cash:     { ar: 'نقداً',   en: 'Cash' },
    transfer: { ar: 'تحويل',   en: 'Transfer' },
    card:     { ar: 'شبكة',    en: 'Card' },
    cheque:   { ar: 'شيك',     en: 'Cheque' },
  };

  // مبلغ بالريال بفواصل آلاف — يُستخدم في كل شاشات المالية
  function money(n) {
    if (n == null || isNaN(n)) return '—';
    var v = Math.round(Number(n) * 100) / 100;
    var s = v.toLocaleString(lang() === 'en' ? 'en-US' : 'ar-SA-u-nu-latn',
      { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    return s + (lang() === 'en' ? ' SAR' : ' ر.س');
  }

  function label(map, key) {
    var e = map[key];
    if (!e) return key || '—';
    return lang() === 'en' ? e.en : e.ar;
  }

  function tone(map, key) {
    return (map[key] && map[key].tone) || 'neutral';
  }

  // تهريب النصوص القادمة من قاعدة البيانات قبل إدراجها في innerHTML
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── واجهة: التنبيهات المنبثقة والقائمة الجانبية ──────────────────────
  function toast(msg, ms) {
    var el = document.getElementById('eduToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'eduToast';
      el.className = 'edu-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('show'); }, ms || 2800);
  }

  function mountSidebar() {
    var side = document.querySelector('.edu-side');
    var burger = document.querySelector('.edu-burger');
    if (!side || !burger) return;
    var backdrop = document.querySelector('.edu-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'edu-backdrop';
      document.body.appendChild(backdrop);
    }
    function close() { side.classList.remove('open'); backdrop.classList.remove('open'); }
    burger.addEventListener('click', function () {
      side.classList.toggle('open');
      backdrop.classList.toggle('open');
    });
    backdrop.addEventListener('click', close);
    side.addEventListener('click', function (e) {
      if (e.target.closest('.edu-nav-item')) close();
    });
  }

  function logout() {
    clearSession();
    location.href = '/edu-login.html';
  }

  // ══════════════════════════════════════════════════════════════════════
  //  الوضع التجريبي — بيانات كاملة مولّدة بالنسبة لتاريخ اليوم
  //  يتيح تجربة المنصة كاملة قبل ربط Supabase.
  // ══════════════════════════════════════════════════════════════════════
  var Demo = (function () {
    function iso(offsetDays) {
      var d = new Date();
      d.setDate(d.getDate() + offsetDays);
      return d.toISOString().slice(0, 10);
    }

    var SUBJECTS = [
      { id: 'sb1', name: 'القرآن الكريم',    color: '#0B5D3B' },
      { id: 'sb2', name: 'اللغة العربية',    color: '#0EA5E9' },
      { id: 'sb3', name: 'الرياضيات',        color: '#7C3AED' },
      { id: 'sb4', name: 'العلوم',           color: '#059669' },
      { id: 'sb5', name: 'اللغة الإنجليزية', color: '#DC2626' },
      { id: 'sb6', name: 'الدراسات الاجتماعية', color: '#D97706' },
      { id: 'sb7', name: 'التربية البدنية',  color: '#0891B2' },
    ];

    var TEACHERS = [
      { id: 'tc1', full_name: 'أ. سعد المطيري',  role: 'teacher' },
      { id: 'tc2', full_name: 'أ. نورة العتيبي', role: 'teacher' },
      { id: 'tc3', full_name: 'أ. خالد الشمري',  role: 'teacher' },
      { id: 'tc4', full_name: 'أ. هند القحطاني', role: 'teacher' },
      { id: 'ad1', full_name: 'إدارة المدرسة',   role: 'school_admin' },
    ];
    // المعلمون وحدهم — الإدارة لا تُحتسب في النصاب ولا في الاحتياط
    var TEACH_ONLY = TEACHERS.filter(function (t) { return t.role === 'teacher'; });

    var CLASSES = [
      { id: 'cl1', name: 'الصف الخامس - أ', grade_level: 5, section: 'أ' },
      { id: 'cl2', name: 'الصف الثاني - ب', grade_level: 2, section: 'ب' },
      { id: 'cl3', name: 'الصف السادس - أ', grade_level: 6, section: 'أ' },
    ];

    var STUDENTS = [
      { id: 'st1', full_name: 'عبدالرحمن محمد', student_number: '4512', class_id: 'cl1' },
      { id: 'st2', full_name: 'ليان محمد',       student_number: '4788', class_id: 'cl2' },
    ];

    // جدول الأسبوع للصف الخامس - أ (الأحد → الخميس، 6 حصص)
    var PERIODS = [
      { period_no: 1, start_time: '07:00', end_time: '07:45' },
      { period_no: 2, start_time: '07:50', end_time: '08:35' },
      { period_no: 3, start_time: '08:40', end_time: '09:25' },
      { period_no: 4, start_time: '09:50', end_time: '10:35' },
      { period_no: 5, start_time: '10:40', end_time: '11:25' },
      { period_no: 6, start_time: '11:30', end_time: '12:15' },
    ];

    var WEEK_PLAN = {
      0: ['sb1', 'sb3', 'sb2', 'sb4', 'sb5', 'sb7'],
      1: ['sb2', 'sb3', 'sb5', 'sb6', 'sb4', 'sb1'],
      2: ['sb3', 'sb4', 'sb2', 'sb5', 'sb1', 'sb6'],
      3: ['sb5', 'sb2', 'sb3', 'sb1', 'sb7', 'sb4'],
      4: ['sb4', 'sb6', 'sb3', 'sb2', 'sb5', 'sb1'],
    };

    function buildTimetable(classId) {
      var out = [];
      // إزاحة المعلمين حسب الفصل حتى لا يتعارض الجميع مع الجميع —
      // ونترك تعارضاً واحداً مقصوداً (الفصل الثالث، الأحد، الحصة الأولى)
      // ليظهر كاشف التعارض وهو يعمل أثناء العرض بدل شاشة فارغة.
      var ci = CLASSES.map(function (c) { return c.id; }).indexOf(classId);
      if (ci < 0) ci = 0;
      SCHOOL_DAYS.forEach(function (wd) {
        (WEEK_PLAN[wd] || []).forEach(function (sid, i) {
          var subj = SUBJECTS.filter(function (s) { return s.id === sid; })[0];
          // (i + ci) % 4 يضمن أن الفصول الثلاثة تأخذ معلمين مختلفين في كل
          // حصة، فلا يوجد تعارض إلا الذي نزرعه عمداً أدناه
          var planted = (ci === 2 && wd === 0 && i === 0);
          var teacher = planted ? TEACH_ONLY[0] : TEACH_ONLY[(i + ci) % TEACH_ONLY.length];
          out.push({
            id: 'tt-' + classId + '-' + wd + '-' + i,
            class_id: classId, subject_id: sid, teacher_id: teacher.id,
            weekday: wd, period_no: PERIODS[i].period_no,
            start_time: PERIODS[i].start_time, end_time: PERIODS[i].end_time,
            room: 'قاعة ' + (101 + (i % 4)),
            subject_name: subj.name, subject_color: subj.color,
            teacher_name: teacher.full_name,
          });
        });
      });
      return out;
    }

    var EXAMS = [
      { id: 'ex1', class_id: 'cl1', subject_id: 'sb3', title: 'اختبار الوحدة الثالثة — الكسور',
        exam_type: 'quiz',    exam_date: iso(2),  start_time: '08:40', duration_min: 45, max_score: 20,
        location: 'قاعة 103', topics: 'الكسور العشرية، جمع وطرح الكسور' },
      { id: 'ex2', class_id: 'cl1', subject_id: 'sb2', title: 'اختبار الفترة الأولى — لغتي',
        exam_type: 'midterm', exam_date: iso(6),  start_time: '07:00', duration_min: 60, max_score: 40,
        location: 'قاعة 101', topics: 'النصوص من ص 20 إلى ص 68' },
      { id: 'ex3', class_id: 'cl1', subject_id: 'sb4', title: 'اختبار قصير — الأجهزة الحيوية',
        exam_type: 'quiz',    exam_date: iso(9),  start_time: '09:50', duration_min: 30, max_score: 15,
        location: 'معمل العلوم', topics: 'الجهاز الهضمي والدوري' },
      { id: 'ex4', class_id: 'cl1', subject_id: 'sb5', title: 'Unit 4 Test',
        exam_type: 'quiz',    exam_date: iso(14), start_time: '10:40', duration_min: 40, max_score: 20,
        location: 'قاعة 104', topics: 'Present perfect, vocabulary units 3–4' },
      { id: 'ex5', class_id: 'cl2', subject_id: 'sb2', title: 'اختبار القراءة',
        exam_type: 'quiz',    exam_date: iso(4),  start_time: '08:00', duration_min: 30, max_score: 15,
        location: 'قاعة 201', topics: 'حروف المد' },
    ];

    var HOMEWORK = [
      { id: 'hw1', class_id: 'cl1', subject_id: 'sb3', teacher_id: 'tc1',
        title: 'تمارين الكسور — صفحة 74', description: 'حل التمارين من 1 إلى 12 في كتاب النشاط.',
        assigned_date: iso(-2), due_date: iso(1), max_score: 10 },
      { id: 'hw2', class_id: 'cl1', subject_id: 'sb2', teacher_id: 'tc2',
        title: 'تلخيص نص "وطني الغالي"', description: 'تلخيص النص في عشرة أسطر بخط واضح.',
        assigned_date: iso(-1), due_date: iso(3), max_score: 10 },
      { id: 'hw3', class_id: 'cl1', subject_id: 'sb5', teacher_id: 'tc3',
        title: 'Workbook pages 30–31', description: 'Complete exercises A, B and C.',
        assigned_date: iso(-5), due_date: iso(-1), max_score: 10 },
      { id: 'hw4', class_id: 'cl1', subject_id: 'sb4', teacher_id: 'tc4',
        title: 'مشروع: دورة الماء', description: 'رسم توضيحي لدورة الماء مع شرح مختصر.',
        assigned_date: iso(-6), due_date: iso(-3), max_score: 10 },
      { id: 'hw5', class_id: 'cl2', subject_id: 'sb2', teacher_id: 'tc2',
        title: 'نسخ حروف المد', description: 'نسخ الحروف ثلاث مرات.',
        assigned_date: iso(-1), due_date: iso(2), max_score: 5 },
    ];

    var HW_STATUS = {
      st1: { hw1: 'pending', hw2: 'pending', hw3: 'submitted', hw4: 'graded' },
      st2: { hw5: 'pending' },
    };
    var HW_SCORE = { st1: { hw4: 9 } };

    function buildGrades(studentId) {
      var seed = studentId === 'st1' ? 0 : 3;
      var rows = [];
      var plan = [
        { sid: 'sb3', kind: 'exam',          title: 'اختبار الوحدة الثانية', score: 18, max: 20, days: -21 },
        { sid: 'sb3', kind: 'homework',      title: 'واجب الوحدة الثانية',   score: 9,  max: 10, days: -18 },
        { sid: 'sb2', kind: 'exam',          title: 'اختبار قصير — الإملاء', score: 17, max: 20, days: -15 },
        { sid: 'sb2', kind: 'participation', title: 'المشاركة الصفية',       score: 9,  max: 10, days: -12 },
        { sid: 'sb4', kind: 'exam',          title: 'اختبار الفصل الأول',    score: 33, max: 40, days: -25 },
        { sid: 'sb4', kind: 'project',       title: 'مشروع النباتات',        score: 10, max: 10, days: -9 },
        { sid: 'sb5', kind: 'exam',          title: 'Unit 3 Test',           score: 14, max: 20, days: -11 },
        { sid: 'sb1', kind: 'exam',          title: 'تسميع سورة الملك',      score: 19, max: 20, days: -7 },
        { sid: 'sb6', kind: 'exam',          title: 'اختبار الخرائط',        score: 12, max: 20, days: -5 },
      ];
      plan.forEach(function (p, i) {
        var subj = SUBJECTS.filter(function (s) { return s.id === p.sid; })[0];
        var adj = Math.max(0, Math.min(p.max, p.score - (seed && i % 2 ? 2 : 0)));
        rows.push({
          id: 'gr-' + studentId + '-' + i, student_id: studentId, subject_id: p.sid,
          kind: p.kind, title: p.title, score: adj, max_score: p.max, weight: p.kind === 'exam' ? 2 : 1,
          term: 'الفصل الأول', published: true,
          teacher_note: p.kind === 'exam' && adj / p.max < 0.7 ? 'يحتاج مراجعة إضافية للمقرر' : null,
          created_at: iso(p.days), subject_name: subj.name, subject_color: subj.color,
        });
      });
      return rows;
    }

    function buildAttendance(studentId) {
      var rows = [];
      var absentDays = studentId === 'st1' ? [-9, -23] : [-4];
      var lateDays = studentId === 'st1' ? [-3, -16] : [];
      for (var i = 0; i < 60; i++) {
        var d = new Date();
        d.setDate(d.getDate() - i);
        if (SCHOOL_DAYS.indexOf(d.getDay()) === -1) continue;
        var status = 'present';
        if (absentDays.indexOf(-i) !== -1) status = i % 2 ? 'excused' : 'absent';
        else if (lateDays.indexOf(-i) !== -1) status = 'late';
        rows.push({
          id: 'at-' + studentId + '-' + i, student_id: studentId,
          date: d.toISOString().slice(0, 10), status: status,
          note: status === 'excused' ? 'إجازة مرضية بعذر مقبول' : null,
        });
      }
      return rows;
    }

    var ANNOUNCEMENTS = [
      { id: 'an1', class_id: null, title: 'اجتماع أولياء الأمور',
        body: 'يسر إدارة المدرسة دعوتكم لاجتماع أولياء الأمور يوم الأربعاء القادم الساعة 5 مساءً في قاعة النشاط.',
        audience: 'parents', pinned: true, created_at: iso(-1) },
      { id: 'an2', class_id: 'cl1', title: 'رحلة مدرسية — متحف العلوم',
        body: 'رحلة الصف الخامس لمتحف العلوم يوم الثلاثاء. الرجاء توقيع نموذج الموافقة عبر المنصة.',
        audience: 'all', pinned: false, created_at: iso(-3) },
      { id: 'an3', class_id: null, title: 'تذكير: بداية اختبارات الفترة',
        body: 'تبدأ اختبارات الفترة الأولى الأسبوع القادم وفق الجدول المنشور في قسم الاختبارات.',
        audience: 'all', pinned: false, created_at: iso(-5) },
    ];

    var MESSAGES = [
      { id: 'ms1', student_id: 'st1', from_user_id: 'tc1', to_user_id: 'pa1',
        body: 'السلام عليكم، عبدالرحمن متميز في الرياضيات هذا الأسبوع وشارك بفاعلية. أحسنتم.',
        created_at: iso(-2) + 'T10:15:00Z', read_at: null },
      { id: 'ms2', student_id: 'st1', from_user_id: 'pa1', to_user_id: 'tc1',
        body: 'وعليكم السلام، شكراً جزيلاً لكم أستاذ سعد. سنواصل المتابعة معه في البيت.',
        created_at: iso(-2) + 'T18:40:00Z', read_at: iso(-2) + 'T19:00:00Z' },
      { id: 'ms3', student_id: 'st1', from_user_id: 'tc3', to_user_id: 'pa1',
        body: 'تنبيه: لم يُسلَّم واجب اللغة الإنجليزية (Workbook 30–31). الرجاء المتابعة.',
        created_at: iso(-1) + 'T09:05:00Z', read_at: null },
    ];

    var PARENT_USER = { id: 'pa1', full_name: 'محمد عبدالله', role: 'parent' };

    // ── المالية ───────────────────────────────────────────────────────
    // أربعة أقساط سنوية لكل طالب: الأول والثاني مسدَّدان، الثالث مستحق
    // قريباً، والرابع لاحقاً — مع قسط متأخر عند أحد الطلاب لإظهار
    // شاشة المتابعة في لوحة المدرسة.
    var FEE_PLANS = [
      { id: 'fp1', name: 'رسوم المرحلة الابتدائية 1447', academic_year: '1447',
        grade_level: null, class_id: null, total_amount: 18000, installments: 4 },
      { id: 'fp2', name: 'رسوم النقل المدرسي 1447', academic_year: '1447',
        grade_level: null, class_id: null, total_amount: 3200, installments: 2 },
    ];

    function buildInvoices(studentId) {
      var plan = studentId === 'st1'
        ? [{ t: 'القسط الأول من 4',  amount: 4500, due: -150, paid: 4500 },
           { t: 'القسط الثاني من 4', amount: 4500, due: -60,  paid: 4500 },
           { t: 'القسط الثالث من 4', amount: 4500, due: 12,   paid: 1500 },
           { t: 'القسط الرابع من 4', amount: 4500, due: 100,  paid: 0 },
           { t: 'رسوم النقل المدرسي', amount: 1600, due: 5,   paid: 0 }]
        : [{ t: 'القسط الأول من 4',  amount: 4000, due: -150, paid: 4000 },
           { t: 'القسط الثاني من 4', amount: 4000, due: -60,  paid: 4000 },
           { t: 'القسط الثالث من 4', amount: 4000, due: -9,   paid: 0 },
           { t: 'القسط الرابع من 4', amount: 4000, due: 100,  paid: 0 }];
      var today = iso(0);
      return plan.map(function (p, i) {
        var due = iso(p.due);
        var net = p.amount;
        var remaining = Math.round((net - p.paid) * 100) / 100;
        var status = remaining <= 0 ? 'paid' : p.paid > 0 ? 'partial' : 'unpaid';
        if (remaining > 0 && due < today) status = 'overdue';
        return {
          id: 'inv-' + studentId + '-' + i, student_id: studentId,
          title: p.t, academic_year: '1447', amount: net, discount: 0,
          due_date: due, net: net, paid: p.paid, remaining: remaining, status: status,
        };
      });
    }

    function buildPayments(studentId) {
      return buildInvoices(studentId).filter(function (inv) { return inv.paid > 0; })
        .map(function (inv, i) {
          return {
            id: 'pay-' + studentId + '-' + i, invoice_id: inv.id, student_id: studentId,
            amount: inv.paid, method: i % 2 ? 'transfer' : 'card',
            reference: 'TRX' + (884210 + i * 37), paid_at: inv.due_date,
          };
        });
    }

    function summarizeFinance(list) {
      var t = { billed: 0, collected: 0, outstanding: 0, overdue: 0, overdue_count: 0 };
      list.forEach(function (inv) {
        if (inv.status === 'cancelled') return;
        t.billed += inv.net;
        t.collected += inv.paid;
        t.outstanding += Math.max(0, inv.remaining);
        if (inv.status === 'overdue') { t.overdue += inv.remaining; t.overdue_count += 1; }
      });
      var r = function (n) { return Math.round(n * 100) / 100; };
      return {
        billed: r(t.billed), collected: r(t.collected), outstanding: r(t.outstanding),
        overdue: r(t.overdue), overdue_count: t.overdue_count, count: list.length,
        collection_rate: t.billed ? Math.round((t.collected / t.billed) * 1000) / 10 : null,
      };
    }

    // لوحة المدرسة تعرض مدرسة بحجم واقعي — نولّد أسماء ومبالغ لـ 412 طالباً
    // بدل الاكتفاء بطالبَي العرض، حتى تبدو الأرقام مقنعة أمام مدير المدرسة.
    var FIRST = ['عبدالرحمن','ليان','سارة','فيصل','نورة','محمد','ريما','خالد','جود','عبدالله',
                 'دانة','تركي','لمى','سلطان','هيا','ناصر','رنا','بدر','شهد','مشاري'];
    var FAMILY = ['المطيري','العتيبي','القحطاني','الشمري','الحربي','الدوسري','الغامدي',
                  'الزهراني','السبيعي','العنزي'];

    var SCHOOL_INVOICES = (function () {
      var out = [];
      for (var i = 0; i < 412; i++) {
        var name = FIRST[i % FIRST.length] + ' ' + FAMILY[(i * 7) % FAMILY.length];
        var cls = CLASSES[i % CLASSES.length];
        var amount = 4500;
        // ‏7% من الطلاب لديهم قسط متأخر — نسبة واقعية لمدرسة أهلية
        var overdue = i % 14 === 0;
        var paid = overdue ? 0 : (i % 5 === 0 ? 2000 : 4500);
        var remaining = amount - paid;
        var status = remaining <= 0 ? 'paid' : (overdue ? 'overdue' : (paid > 0 ? 'partial' : 'unpaid'));
        out.push({
          id: 'sinv' + i, student_id: 'sst' + i, student_name: name,
          student_number: String(4000 + i), class_name: cls.name,
          title: 'القسط الثالث من 4', due_date: iso(overdue ? -(9 + (i % 20)) : 12),
          amount: amount, discount: 0, net: amount, paid: paid,
          remaining: remaining, status: status, academic_year: '1447',
        });
      }
      return out;
    })();

    function studentsFor(session) {
      if (session.user.role === 'student') return [STUDENTS[0]];
      if (session.user.role === 'parent') return STUDENTS;
      return STUDENTS;
    }

    function decorateStudent(s) {
      var cl = CLASSES.filter(function (c) { return c.id === s.class_id; })[0];
      return Object.assign({}, s, { class_name: cl ? cl.name : null });
    }

    function homeworkFor(studentId, classId) {
      var today = iso(0);
      return HOMEWORK.filter(function (h) { return h.class_id === classId; }).map(function (h) {
        var subj = SUBJECTS.filter(function (s) { return s.id === h.subject_id; })[0];
        var teacher = TEACHERS.filter(function (t) { return t.id === h.teacher_id; })[0];
        var status = (HW_STATUS[studentId] || {})[h.id] || 'pending';
        if (status === 'pending' && h.due_date < today) status = 'late';
        return Object.assign({}, h, {
          status: status,
          score: (HW_SCORE[studentId] || {})[h.id] != null ? HW_SCORE[studentId][h.id] : null,
          subject_name: subj ? subj.name : null, subject_color: subj ? subj.color : null,
          teacher_name: teacher ? teacher.full_name : null,
        });
      }).sort(function (a, b) { return a.due_date < b.due_date ? -1 : 1; });
    }

    function examsFor(classId, fromToday) {
      var today = iso(0);
      return EXAMS.filter(function (e) {
        return e.class_id === classId && (!fromToday || e.exam_date >= today);
      }).map(function (e) {
        var subj = SUBJECTS.filter(function (s) { return s.id === e.subject_id; })[0];
        var cl = CLASSES.filter(function (c) { return c.id === e.class_id; })[0];
        return Object.assign({}, e, {
          subject_name: subj ? subj.name : null, subject_color: subj ? subj.color : null,
          class_name: cl ? cl.name : null,
          teacher_name: TEACHERS[0].full_name,
        });
      }).sort(function (a, b) { return a.exam_date < b.exam_date ? -1 : 1; });
    }

    function summarizeGrades(grades) {
      var by = {};
      grades.forEach(function (g) {
        if (g.score == null || !g.max_score) return;
        if (!by[g.subject_id]) {
          by[g.subject_id] = { subject_id: g.subject_id, subject_name: g.subject_name,
                               subject_color: g.subject_color, weighted: 0, weight: 0, count: 0 };
        }
        var w = Number(g.weight) || 1;
        by[g.subject_id].weighted += (g.score / g.max_score) * 100 * w;
        by[g.subject_id].weight += w;
        by[g.subject_id].count += 1;
      });
      var subjects = Object.keys(by).map(function (k) {
        var s = by[k];
        return { subject_id: s.subject_id, subject_name: s.subject_name, subject_color: s.subject_color,
                 count: s.count, average: Math.round((s.weighted / s.weight) * 10) / 10 };
      });
      var overall = subjects.length
        ? Math.round((subjects.reduce(function (a, s) { return a + s.average; }, 0) / subjects.length) * 10) / 10
        : null;
      return { subjects: subjects, overall: overall };
    }

    function summarizeAttendance(rows) {
      var c = { present: 0, absent: 0, late: 0, excused: 0 };
      rows.forEach(function (r) { if (c[r.status] !== undefined) c[r.status] += 1; });
      var total = rows.length;
      return Object.assign({}, c, { total: total,
        rate: total ? Math.round((c.present / total) * 1000) / 10 : null });
    }

    function handle(action, payload, session) {
      var role = session.user.role;
      var kids = studentsFor(session).map(decorateStudent);

      if (action === 'overview' && (role === 'parent' || role === 'student')) {
        var active = kids.filter(function (k) { return k.id === payload.student_id; })[0] || kids[0];
        var tt = buildTimetable(active.class_id);
        var grades = buildGrades(active.id);
        var att = buildAttendance(active.id);
        var hw = homeworkFor(active.id, active.class_id);
        var wd = new Date().getDay();
        return Promise.resolve({
          children: kids,
          active: active,
          today: tt.filter(function (t) { return t.weekday === wd; }),
          timetable: tt,
          exams: examsFor(active.class_id, true),
          homework: hw,
          homework_due: hw.filter(function (h) { return h.status === 'pending' || h.status === 'late'; }),
          grades: grades.slice(0, 20),
          grade_summary: summarizeGrades(grades),
          attendance_summary: summarizeAttendance(att),
          announcements: ANNOUNCEMENTS.filter(function (a) {
            return !a.class_id || a.class_id === active.class_id;
          }),
        });
      }

      if (action === 'overview') { // كادر المدرسة
        return Promise.resolve({
          stats: {
            students: 412, classes: CLASSES.length, subjects: SUBJECTS.length,
            teachers: TEACHERS.length - 1,
            attendance_today: { present: 389, absent: 14, late: 7, excused: 2, total: 412, rate: 94.4 },
          },
          classes: CLASSES, subjects: SUBJECTS,
          teachers: TEACHERS.filter(function (t) { return t.role === 'teacher'; }),
          exams: examsFor('cl1', true).concat(examsFor('cl2', true)),
          homework: HOMEWORK.map(function (h) {
            var subj = SUBJECTS.filter(function (s) { return s.id === h.subject_id; })[0];
            var cl = CLASSES.filter(function (c) { return c.id === h.class_id; })[0];
            return Object.assign({}, h, { subject_name: subj ? subj.name : null,
                                          class_name: cl ? cl.name : null });
          }),
          announcements: ANNOUNCEMENTS,
        });
      }

      var target = kids.filter(function (k) { return k.id === payload.student_id; })[0] || kids[0];

      if (action === 'timetable') return Promise.resolve({ timetable: buildTimetable(target.class_id) });
      if (action === 'exams') return Promise.resolve({ exams: examsFor(target.class_id, false) });
      if (action === 'homework') return Promise.resolve({ homework: homeworkFor(target.id, target.class_id) });
      if (action === 'grades') {
        var g = buildGrades(target.id);
        return Promise.resolve({ grades: g, summary: summarizeGrades(g) });
      }
      if (action === 'attendance') {
        var a = buildAttendance(target.id);
        return Promise.resolve({ attendance: a, summary: summarizeAttendance(a) });
      }
      if (action === 'student_profile') return Promise.resolve({ student: target });
      if (action === 'announcements') return Promise.resolve({ announcements: ANNOUNCEMENTS });

      if (action === 'messages') {
        return Promise.resolve({
          messages: MESSAGES,
          people: TEACHERS.concat([PARENT_USER]),
          contacts: TEACHERS,
        });
      }

      if (action === 'send_message') {
        var msg = {
          id: 'ms' + (MESSAGES.length + 1), student_id: payload.student_id || target.id,
          from_user_id: session.user.id, to_user_id: payload.to_user_id,
          body: payload.body, created_at: new Date().toISOString(), read_at: null,
        };
        MESSAGES.push(msg);
        return Promise.resolve({ message: msg });
      }

      if (action === 'submit_homework') {
        HW_STATUS[target.id] = HW_STATUS[target.id] || {};
        HW_STATUS[target.id][payload.homework_id] = 'submitted';
        return Promise.resolve({ ok: true });
      }

      if (action === 'roster') {
        return Promise.resolve({
          students: STUDENTS.map(decorateStudent), classes: CLASSES,
          subjects: SUBJECTS, teachers: TEACHERS,
        });
      }

      // ── الجدول: الشبكة والنصاب والتعارضات ───────────────────────────
      if (action === 'timetable_board') {
        var all = CLASSES.reduce(function (acc, c) {
          return acc.concat(buildTimetable(c.id).map(function (r) {
            return Object.assign({}, r, { class_name: c.name });
          }));
        }, []);
        var load = {}, seen = {}, conflicts = [];
        TEACH_ONLY.forEach(function (t) {
          load[t.id] = { teacher_id: t.id, full_name: t.full_name, periods: 0, days: {} };
        });
        all.forEach(function (r) {
          if (!r.teacher_id || !load[r.teacher_id]) return;
          load[r.teacher_id].periods += 1;
          load[r.teacher_id].days[r.weekday] = 1;
          var k = r.teacher_id + '|' + r.weekday + '|' + r.period_no;
          if (seen[k]) {
            conflicts.push({
              teacher_id: r.teacher_id, teacher_name: r.teacher_name,
              weekday: r.weekday, period_no: r.period_no,
              classes: [seen[k].class_name, r.class_name],
            });
          } else { seen[k] = r; }
        });
        return Promise.resolve({
          timetable: all, classes: CLASSES, subjects: SUBJECTS, teachers: TEACH_ONLY,
          load: Object.keys(load).map(function (k) {
            return { teacher_id: load[k].teacher_id, full_name: load[k].full_name,
                     periods: load[k].periods, days: Object.keys(load[k].days).length };
          }).sort(function (a, b) { return b.periods - a.periods; }),
          conflicts: conflicts,
        });
      }

      if (action === 'teacher_schedule') {
        var tid = payload.teacher_id || TEACH_ONLY[0].id;
        var mine = CLASSES.reduce(function (acc, c) {
          return acc.concat(buildTimetable(c.id).filter(function (r) { return r.teacher_id === tid; })
            .map(function (r) { return Object.assign({}, r, { class_name: c.name }); }));
        }, []);
        var days = {};
        mine.forEach(function (r) { days[r.weekday] = (days[r.weekday] || 0) + 1; });
        return Promise.resolve({
          teacher_id: tid,
          teacher_name: (TEACH_ONLY.filter(function (t) { return t.id === tid; })[0] || {}).full_name,
          timetable: mine, teachers: TEACH_ONLY,
          load: { periods: mine.length, days: Object.keys(days).length, by_day: days },
        });
      }

      if (action === 'substitutes') {
        var wd = parseInt(payload.weekday, 10);
        var absent = payload.teacher_id || TEACH_ONLY[0].id;
        var dayRows = CLASSES.reduce(function (acc, c) {
          return acc.concat(buildTimetable(c.id).filter(function (r) { return r.weekday === wd; })
            .map(function (r) { return Object.assign({}, r, { class_name: c.name }); }));
        }, []);
        var busy = {};
        dayRows.forEach(function (r) {
          if (!r.teacher_id) return;
          (busy[r.period_no] = busy[r.period_no] || {})[r.teacher_id] = 1;
        });
        return Promise.resolve({
          weekday: wd,
          teacher_name: (TEACH_ONLY.filter(function (t) { return t.id === absent; })[0] || {}).full_name,
          teachers: TEACH_ONLY,
          gaps: dayRows.filter(function (r) { return r.teacher_id === absent; }).map(function (r) {
            return {
              period_no: r.period_no, start_time: r.start_time,
              class_id: r.class_id, class_name: r.class_name,
              subject_id: r.subject_id, subject_name: r.subject_name,
              available: TEACH_ONLY.filter(function (t) {
                return t.id !== absent && !(busy[r.period_no] || {})[t.id];
              }).map(function (t) { return { id: t.id, full_name: t.full_name }; }),
            };
          }),
        });
      }

      // ── المالية ─────────────────────────────────────────────────────
      if (action === 'finance') {
        return Promise.resolve({
          summary: summarizeFinance(SCHOOL_INVOICES),
          invoices: SCHOOL_INVOICES,
          overdue: SCHOOL_INVOICES.filter(function (i) { return i.status === 'overdue'; })
            .sort(function (a, b) { return b.remaining - a.remaining; }),
          payments: SCHOOL_INVOICES.filter(function (i) { return i.paid > 0; })
            .slice(0, 20).map(function (i, n) {
              return { id: 'p' + n, invoice_id: i.id, student_id: i.student_id,
                       student_name: i.student_name, amount: i.paid,
                       method: n % 2 ? 'transfer' : 'card', paid_at: iso(-(n % 25)) };
            }),
          plans: FEE_PLANS, students: STUDENTS.map(decorateStudent), classes: CLASSES,
        });
      }

      if (action === 'fees') {
        var invs = buildInvoices(target.id);
        return Promise.resolve({
          invoices: invs, payments: buildPayments(target.id), summary: summarizeFinance(invs),
        });
      }

      if (action === 'record_payment' || action === 'issue_invoices' || action === 'import_students') {
        return Promise.resolve({ ok: true, demo: true });
      }

      // ── كشف الدرجات ─────────────────────────────────────────────────
      if (action === 'report_card') {
        var rcGrades = buildGrades(target.id);
        return Promise.resolve({
          student: target,
          school: { name: session.user.school_name || 'مدرسة الرواد الأهلية',
                    stage: 'ابتدائي', city: 'الرياض' },
          term: 'الفصل الأول',
          grades: rcGrades,
          grade_summary: summarizeGrades(rcGrades),
          attendance_summary: summarizeAttendance(buildAttendance(target.id)),
        });
      }

      if (action === 'save' || action === 'delete') {
        return Promise.resolve({ ok: true, demo: true });
      }

      return Promise.resolve({});
    }

    // حسابات العرض التجريبي
    var ACCOUNTS = {
      'parent@demo.sa':  { id: 'pa1', role: 'parent',       full_name: 'محمد عبدالله' },
      'student@demo.sa': { id: 'su1', role: 'student',      full_name: 'عبدالرحمن محمد' },
      'school@demo.sa':  { id: 'ad1', role: 'school_admin', full_name: 'إدارة مدرسة الرواد' },
    };

    function login(identifier) {
      var acc = ACCOUNTS[String(identifier || '').trim().toLowerCase()];
      if (!acc) return null;
      return {
        demo: true,
        token: 'demo',
        user: Object.assign({}, acc, {
          school_id: 'sc1',
          school_name: 'مدرسة الرواد الأهلية',
          email: identifier,
        }),
      };
    }

    return { handle: handle, login: login, ACCOUNTS: ACCOUNTS };
  })();

  global.Edu = {
    getSession: getSession, setSession: setSession, clearSession: clearSession,
    isDemo: isDemo, requireRole: requireRole, homeFor: homeFor, logout: logout,
    callApi: callApi, data: data,
    WEEKDAYS_AR: WEEKDAYS_AR, SCHOOL_DAYS: SCHOOL_DAYS, PERIOD_COUNT: 6,
    lang: lang, weekdayName: weekdayName,
    fmtDate: fmtDate, fmtShort: fmtShort, fmtTime: fmtTime,
    daysUntil: daysUntil, relativeDay: relativeDay,
    initials: initials, pct: pct, gradeTone: gradeTone, esc: esc,
    HW_LABELS: HW_LABELS, ATT_LABELS: ATT_LABELS, EXAM_LABELS: EXAM_LABELS,
    INV_LABELS: INV_LABELS, PAY_LABELS: PAY_LABELS, money: money,
    label: label, tone: tone,
    toast: toast, mountSidebar: mountSidebar,
    Demo: Demo,
  };
})(window);
