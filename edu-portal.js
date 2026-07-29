/* ============================================================
   رفد تعليم — منطق بوابة المتابعة المشترك
   تستخدمه صفحتا edu-parent.html و edu-student.html.
   الفارق الوحيد بين الدورين هو الدور المسموح والعناوين، ويُمرَّر
   عبر window.EDU_PORTAL_ROLE ('parent' | 'student') قبل تحميل الملف.
   ============================================================ */
(function () {
  var ROLE = window.EDU_PORTAL_ROLE === 'student' ? 'student' : 'parent';
  var IS_STUDENT = ROLE === 'student';
  var session = Edu.requireRole([ROLE]);
  if (!session) return;

  var state = { view: 'overview', studentId: null, overview: null };
  var viewEl = document.getElementById('view');
  var E = Edu.esc;

  // ── رأس الصفحة ───────────────────────────────────────────────────────
  document.getElementById('userName').textContent = session.user.full_name;
  document.getElementById('userAvatar').textContent = Edu.initials(session.user.full_name);
  document.getElementById('schoolName').textContent = session.user.school_name || 'المدرسة';
  document.getElementById('logoutBtn').onclick = Edu.logout;
  Edu.mountSidebar();

  if (Edu.isDemo()) {
    document.getElementById('demoBanner').innerHTML =
      '<div class="edu-alert info">أنت في <strong>الوضع التجريبي</strong> — البيانات المعروضة توضيحية لعرض شكل المنصة. ' +
      (IS_STUDENT ? 'عند ربط مدرستك تظهر بياناتك الحقيقية مباشرة.'
                  : 'عند ربط المدرسة تظهر بيانات ابنك الحقيقية مباشرة من نظام المدرسة.') + '</div>';
  }

  var TITLES = IS_STUDENT ? {
    overview: 'صفحتي', timetable: 'جدولي الدراسي', exams: 'اختباراتي',
    homework: 'واجباتي', grades: 'درجاتي ومستواي', attendance: 'حضوري',
    announcements: 'إعلانات المدرسة', messages: 'التواصل مع معلميّ',
  } : {
    overview: 'نظرة عامة', timetable: 'الجدول الدراسي', exams: 'الاختبارات',
    homework: 'الواجبات', grades: 'الدرجات والمستوى', attendance: 'الحضور والغياب',
    announcements: 'إعلانات المدرسة', messages: 'التواصل مع المعلمين',
  };

  // عناوين القائمة الجانبية تتبع نفس الاختلاف
  Array.prototype.forEach.call(document.querySelectorAll('.edu-nav-item[data-view]'), function (b) {
    var key = b.getAttribute('data-view');
    var lbl = b.querySelector('.lbl');
    if (lbl && TITLES[key]) lbl.textContent = TITLES[key];
  });

  Array.prototype.forEach.call(document.querySelectorAll('.edu-nav-item[data-view]'), function (btn) {
    btn.addEventListener('click', function () { go(btn.getAttribute('data-view')); });
  });

  function go(view) {
    state.view = view;
    document.getElementById('viewTitle').textContent = TITLES[view] || '';
    Array.prototype.forEach.call(document.querySelectorAll('.edu-nav-item[data-view]'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === view);
    });
    location.hash = view;
    render();
  }

  function loading() {
    viewEl.innerHTML = '<div class="edu-card"><div class="edu-skeleton" style="width:35%"></div>' +
      '<div class="edu-skeleton"></div><div class="edu-skeleton" style="width:60%"></div></div>';
  }

  function fail(e) {
    viewEl.innerHTML = '<div class="edu-alert danger">' + E(e.message || 'تعذّر تحميل البيانات') + '</div>';
  }

  // ── منتقي الأبناء ────────────────────────────────────────────────────
  function renderKids(children, activeId) {
    var bar = document.getElementById('kidsBar');
    if (!children || children.length < 2) { bar.innerHTML = ''; return; }
    bar.innerHTML = children.map(function (c) {
      return '<button class="edu-kid' + (c.id === activeId ? ' active' : '') + '" data-kid="' + E(c.id) + '">' +
        '<span class="edu-avatar">' + E(Edu.initials(c.full_name)) + '</span>' +
        '<span>' + E(c.full_name) + '<small>' + E(c.class_name || '') + '</small></span></button>';
    }).join('');
    Array.prototype.forEach.call(bar.querySelectorAll('[data-kid]'), function (b) {
      b.addEventListener('click', function () {
        state.studentId = b.getAttribute('data-kid');
        state.overview = null;
        render();
      });
    });
  }

  // ── جلب النظرة العامة (مشتركة بين معظم الشاشات) ───────────────────────
  async function ensureOverview() {
    if (state.overview) return state.overview;
    var res = await Edu.data('overview', { student_id: state.studentId });
    state.overview = res;
    state.studentId = res.active ? res.active.id : null;
    renderKids(res.children, state.studentId);
    var due = (res.homework_due || []).length;
    var badge = document.getElementById('hwBadge');
    badge.hidden = !due;
    badge.textContent = due;
    return res;
  }

  // ── الشاشات ──────────────────────────────────────────────────────────
  async function render() {
    loading();
    try {
      var d = await ensureOverview();
      if (!d.active) {
        viewEl.innerHTML = '<div class="edu-empty"><div class="ico">🎒</div>' +
          (IS_STUDENT
            ? '<p>لم يُربط حسابك بسجل طالب بعد. تواصل مع إدارة المدرسة.</p></div>'
            : '<p>لا يوجد أبناء مرتبطون بحسابك بعد. تواصل مع إدارة المدرسة لربط حسابك بأبنائك.</p></div>');
        return;
      }
      ({
        overview: viewOverview, timetable: viewTimetable, exams: viewExams,
        homework: viewHomework, grades: viewGrades, attendance: viewAttendance,
        announcements: viewAnnouncements, messages: viewMessages,
      }[state.view] || viewOverview)(d);
    } catch (e) { fail(e); }
  }

  // 1) نظرة عامة ────────────────────────────────────────────────────────
  function viewOverview(d) {
    var gs = d.grade_summary || {};
    var att = d.attendance_summary || {};
    var due = d.homework_due || [];
    var nextExams = (d.exams || []).slice(0, 4);

    var html = '<div class="edu-grid c4" style="margin-bottom:1.25rem">' +
      stat('المعدل العام', gs.overall != null ? gs.overall + '%' : '—',
           (gs.subjects || []).length + ' مواد مرصودة', '') +
      stat('نسبة الحضور', att.rate != null ? att.rate + '%' : '—',
           (att.absent || 0) + ' غياب · ' + (att.late || 0) + ' تأخير',
           att.rate != null && att.rate < 90 ? 'amber' : 'sky') +
      stat('واجبات مستحقة', due.length, due.length ? 'تحتاج متابعة' : 'كل شيء مُسلَّم',
           due.length ? 'amber' : '') +
      stat('اختبارات قادمة', (d.exams || []).length,
           nextExams[0] ? 'أقربها ' + Edu.relativeDay(nextExams[0].exam_date) : 'لا يوجد', 'sky') +
      '</div>';

    html += '<div class="edu-grid c2">';

    // حصص اليوم
    html += '<div class="edu-card"><div class="edu-card-head"><h2>📅 حصص اليوم — ' +
      E(Edu.weekdayName(new Date().getDay())) + '</h2>' +
      '<a class="more edu-btn ghost sm" href="#timetable" data-nav="timetable">كل الجدول</a></div>';
    if (!(d.today || []).length) {
      html += '<div class="edu-empty"><div class="ico">🌤️</div><p>لا توجد حصص اليوم</p></div>';
    } else {
      html += '<div class="edu-list">' + d.today.map(function (p) {
        return row('<span class="edu-dot" style="background:' + E(p.subject_color || '#F1F5F9') + '22">📘</span>',
          E(p.subject_name || 'حصة'),
          'الحصة ' + p.period_no + (p.teacher_name ? ' · ' + E(p.teacher_name) : '') + (p.room ? ' · ' + E(p.room) : ''),
          '<span class="edu-badge">' + E(Edu.fmtTime(p.start_time)) + '</span>');
      }).join('') + '</div>';
    }
    html += '</div>';

    // الواجبات المستحقة
    html += '<div class="edu-card"><div class="edu-card-head"><h2>📚 واجبات تحتاج متابعة</h2>' +
      '<a class="more edu-btn ghost sm" href="#homework" data-nav="homework">الكل</a></div>';
    if (!due.length) {
      html += '<div class="edu-empty"><div class="ico">🎉</div><p>لا توجد واجبات متأخرة أو معلّقة</p></div>';
    } else {
      html += '<div class="edu-list">' + due.slice(0, 5).map(hwRow).join('') + '</div>';
    }
    html += '</div>';

    // الاختبارات القادمة
    html += '<div class="edu-card"><div class="edu-card-head"><h2>📝 اختبارات قادمة</h2>' +
      '<a class="more edu-btn ghost sm" href="#exams" data-nav="exams">الكل</a></div>';
    if (!nextExams.length) {
      html += '<div class="edu-empty"><div class="ico">📭</div><p>لا توجد اختبارات مجدولة</p></div>';
    } else {
      html += '<div class="edu-list">' + nextExams.map(examRow).join('') + '</div>';
    }
    html += '</div>';

    // مستوى المواد
    html += '<div class="edu-card"><div class="edu-card-head"><h2>📊 المستوى في كل مادة</h2>' +
      '<a class="more edu-btn ghost sm" href="#grades" data-nav="grades">التفاصيل</a></div>';
    var subs = (gs.subjects || []).slice().sort(function (a, b) { return a.average - b.average; });
    if (!subs.length) {
      html += '<div class="edu-empty"><div class="ico">📈</div><p>لم تُرصد درجات بعد</p></div>';
    } else {
      html += subs.slice(0, 6).map(subjectBar).join('');
    }
    html += '</div>';

    html += '</div>';

    // آخر الإعلانات
    if ((d.announcements || []).length) {
      html += '<div class="edu-card"><div class="edu-card-head"><h2>📢 آخر إعلانات المدرسة</h2>' +
        '<a class="more edu-btn ghost sm" href="#announcements" data-nav="announcements">الكل</a></div>' +
        '<div class="edu-list">' + d.announcements.slice(0, 3).map(annRow).join('') + '</div></div>';
    }

    viewEl.innerHTML = html;
    wireNav();
  }

  // 2) الجدول الدراسي ───────────────────────────────────────────────────
  function viewTimetable(d) {
    var tt = d.timetable || [];
    if (!tt.length) {
      viewEl.innerHTML = '<div class="edu-card"><div class="edu-empty"><div class="ico">📅</div>' +
        '<p>لم يُنشر الجدول الدراسي بعد</p></div></div>';
      return;
    }
    var periods = [];
    tt.forEach(function (p) { if (periods.indexOf(p.period_no) === -1) periods.push(p.period_no); });
    periods.sort(function (a, b) { return a - b; });

    var todayWd = new Date().getDay();
    var html = '<div class="edu-card"><div class="edu-card-head"><h2>جدول الأسبوع — ' +
      E(d.active.class_name || '') + '</h2>' +
      '<button class="more edu-btn ghost sm" onclick="window.print()">🖨️ طباعة</button></div>' +
      '<div class="edu-table-wrap"><table class="edu-table"><thead><tr><th>الحصة</th>' +
      Edu.SCHOOL_DAYS.map(function (wd) {
        return '<th' + (wd === todayWd ? ' style="color:#0B5D3B"' : '') + '>' + E(Edu.weekdayName(wd)) +
          (wd === todayWd ? ' •' : '') + '</th>';
      }).join('') + '</tr></thead><tbody>';

    periods.forEach(function (pn) {
      var sample = tt.filter(function (t) { return t.period_no === pn; })[0];
      html += '<tr><td><strong>' + pn + '</strong><br><small style="color:var(--edu-muted)">' +
        E(Edu.fmtTime(sample && sample.start_time)) + '</small></td>';
      Edu.SCHOOL_DAYS.forEach(function (wd) {
        var cell = tt.filter(function (t) { return t.weekday === wd && t.period_no === pn; })[0];
        if (!cell) { html += '<td>—</td>'; return; }
        html += '<td><div class="edu-period' + (wd === todayWd ? ' now' : '') + '"' +
          (cell.subject_color ? ' style="border-inline-start:3px solid ' + E(cell.subject_color) + '"' : '') + '>' +
          '<strong>' + E(cell.subject_name || '—') + '</strong>' +
          '<small>' + E(cell.teacher_name || '') + (cell.room ? ' · ' + E(cell.room) : '') + '</small></div></td>';
      });
      html += '</tr>';
    });
    viewEl.innerHTML = html + '</tbody></table></div></div>';
  }

  // 3) الاختبارات ───────────────────────────────────────────────────────
  async function viewExams() {
    loading();
    try {
      var res = await Edu.data('exams', { student_id: state.studentId });
      var exams = res.exams || [];
      var today = new Date().toISOString().slice(0, 10);
      var upcoming = exams.filter(function (e) { return e.exam_date >= today; });
      var past = exams.filter(function (e) { return e.exam_date < today; }).reverse();

      var html = '<div class="edu-card"><div class="edu-card-head"><h2>📝 اختبارات قادمة (' + upcoming.length + ')</h2></div>';
      html += upcoming.length
        ? '<div class="edu-list">' + upcoming.map(examCard).join('') + '</div>'
        : '<div class="edu-empty"><div class="ico">📭</div><p>لا توجد اختبارات مجدولة حالياً</p></div>';
      html += '</div>';

      if (past.length) {
        html += '<div class="edu-card"><div class="edu-card-head"><h2>اختبارات سابقة</h2></div>' +
          '<div class="edu-list">' + past.map(examRow).join('') + '</div></div>';
      }
      viewEl.innerHTML = html;
    } catch (e) { fail(e); }
  }

  function examCard(x) {
    var n = Edu.daysUntil(x.exam_date);
    var tone = n <= 1 ? 'danger' : n <= 3 ? 'warn' : 'info';
    return '<div class="edu-row">' +
      '<span class="edu-dot" style="background:' + E(x.subject_color || '#0EA5E9') + '1a">📝</span>' +
      '<div class="edu-row-main"><div class="edu-row-title">' + E(x.title) + '</div>' +
      '<div class="edu-row-sub">' + E(x.subject_name || '') + ' · ' +
      E(Edu.label(Edu.EXAM_LABELS, x.exam_type)) + ' · ' + E(Edu.fmtDate(x.exam_date)) +
      (x.start_time ? ' · ' + E(Edu.fmtTime(x.start_time)) : '') +
      (x.duration_min ? ' · ' + x.duration_min + ' دقيقة' : '') +
      (x.location ? ' · ' + E(x.location) : '') + '</div>' +
      (x.topics ? '<div class="edu-row-sub" style="margin-top:.35rem"><strong>المقرر:</strong> ' + E(x.topics) + '</div>' : '') +
      '</div><div class="edu-row-end"><span class="edu-badge ' + tone + '">' +
      E(Edu.relativeDay(x.exam_date)) + '</span><div class="edu-row-sub" style="margin-top:.3rem">' +
      'من ' + E(x.max_score) + '</div></div></div>';
  }

  function examRow(x) {
    return row('<span class="edu-dot">📝</span>', E(x.title),
      E(x.subject_name || '') + ' · ' + E(Edu.fmtDate(x.exam_date)) + (x.location ? ' · ' + E(x.location) : ''),
      '<span class="edu-badge info">' + E(Edu.relativeDay(x.exam_date)) + '</span>');
  }

  // 4) الواجبات ─────────────────────────────────────────────────────────
  async function viewHomework() {
    loading();
    try {
      var res = await Edu.data('homework', { student_id: state.studentId });
      var hw = res.homework || [];
      var open = hw.filter(function (h) { return h.status === 'pending' || h.status === 'late'; });
      var done = hw.filter(function (h) { return h.status === 'submitted' || h.status === 'graded'; });

      var html = '<div class="edu-card"><div class="edu-card-head"><h2>📚 واجبات مطلوبة (' + open.length + ')</h2></div>';
      html += open.length
        ? '<div class="edu-list">' + open.map(hwCard).join('') + '</div>'
        : '<div class="edu-empty"><div class="ico">🎉</div><p>لا توجد واجبات معلّقة</p></div>';
      html += '</div>';

      if (done.length) {
        html += '<div class="edu-card"><div class="edu-card-head"><h2>واجبات منجزة</h2></div>' +
          '<div class="edu-list">' + done.map(hwCard).join('') + '</div></div>';
      }
      viewEl.innerHTML = html;

      Array.prototype.forEach.call(viewEl.querySelectorAll('[data-submit]'), function (b) {
        b.addEventListener('click', async function () {
          b.disabled = true;
          try {
            await Edu.data('submit_homework', {
              student_id: state.studentId, homework_id: b.getAttribute('data-submit'),
            });
            Edu.toast('تم تسجيل التسليم');
            state.overview = null;
            viewHomework();
          } catch (e) { Edu.toast(e.message); b.disabled = false; }
        });
      });
    } catch (e) { fail(e); }
  }

  function hwCard(h) {
    var t = Edu.tone(Edu.HW_LABELS, h.status);
    var canSubmit = h.status === 'pending' || h.status === 'late';
    return '<div class="edu-row">' +
      '<span class="edu-dot" style="background:' + E(h.subject_color || '#0B5D3B') + '1a">📖</span>' +
      '<div class="edu-row-main"><div class="edu-row-title">' + E(h.title) + '</div>' +
      '<div class="edu-row-sub">' + E(h.subject_name || '') +
      (h.teacher_name ? ' · ' + E(h.teacher_name) : '') +
      ' · التسليم ' + E(Edu.fmtDate(h.due_date)) + ' (' + E(Edu.relativeDay(h.due_date)) + ')</div>' +
      (h.description ? '<div class="edu-row-sub" style="margin-top:.3rem">' + E(h.description) + '</div>' : '') +
      (h.score != null ? '<div class="edu-row-sub" style="margin-top:.3rem"><strong>الدرجة:</strong> ' +
        E(h.score) + ' من ' + E(h.max_score) + '</div>' : '') +
      '</div><div class="edu-row-end"><span class="edu-badge ' + t + '">' +
      E(Edu.label(Edu.HW_LABELS, h.status)) + '</span>' +
      (canSubmit ? '<div style="margin-top:.45rem"><button class="edu-btn ghost sm" data-submit="' +
        E(h.id) + '">تم التسليم</button></div>' : '') +
      '</div></div>';
  }

  function hwRow(h) {
    return row('<span class="edu-dot">📖</span>', E(h.title),
      E(h.subject_name || '') + ' · ' + E(Edu.relativeDay(h.due_date)),
      '<span class="edu-badge ' + Edu.tone(Edu.HW_LABELS, h.status) + '">' +
      E(Edu.label(Edu.HW_LABELS, h.status)) + '</span>');
  }

  // 5) الدرجات ──────────────────────────────────────────────────────────
  async function viewGrades() {
    loading();
    try {
      var res = await Edu.data('grades', { student_id: state.studentId });
      var grades = res.grades || [];
      var sum = res.summary || {};
      var subs = (sum.subjects || []).slice().sort(function (a, b) { return b.average - a.average; });

      var html = '<div class="edu-grid c3" style="margin-bottom:1.25rem">' +
        stat('المعدل العام', sum.overall != null ? sum.overall + '%' : '—', 'متوسط موزون لكل المواد', '') +
        stat('أعلى مادة', subs[0] ? subs[0].subject_name : '—',
             subs[0] ? subs[0].average + '%' : '', 'sky') +
        stat('تحتاج دعم', subs.length ? subs[subs.length - 1].subject_name : '—',
             subs.length ? subs[subs.length - 1].average + '%' : '', 'amber') +
        '</div>';

      html += '<div class="edu-card"><div class="edu-card-head"><h2>📊 المستوى في كل مادة</h2></div>';
      html += subs.length ? subs.map(subjectBar).join('')
        : '<div class="edu-empty"><div class="ico">📈</div><p>لم تُرصد درجات بعد</p></div>';
      html += '</div>';

      html += '<div class="edu-card"><div class="edu-card-head"><h2>سجل الدرجات</h2></div>';
      if (!grades.length) {
        html += '<div class="edu-empty"><div class="ico">📋</div><p>لا توجد درجات مرصودة</p></div>';
      } else {
        html += '<div class="edu-table-wrap"><table class="edu-table"><thead><tr>' +
          '<th>المادة</th><th>العنوان</th><th>النوع</th><th>الدرجة</th><th>النسبة</th><th>التاريخ</th>' +
          '</tr></thead><tbody>' + grades.map(function (g) {
            var p = Edu.pct(g.score, g.max_score);
            return '<tr><td>' + E(g.subject_name || '—') + '</td><td>' + E(g.title || '—') +
              (g.teacher_note ? '<br><small style="color:var(--edu-muted)">' + E(g.teacher_note) + '</small>' : '') +
              '</td><td>' + E(kindLabel(g.kind)) + '</td><td><strong>' + E(g.score) + '</strong> / ' +
              E(g.max_score) + '</td><td><span class="edu-badge ' + Edu.gradeTone(p) + '">' +
              (p == null ? '—' : p + '%') + '</span></td><td>' + E(Edu.fmtShort(g.created_at)) + '</td></tr>';
          }).join('') + '</tbody></table></div>';
      }
      viewEl.innerHTML = html + '</div>';
    } catch (e) { fail(e); }
  }

  function kindLabel(k) {
    return { exam: 'اختبار', homework: 'واجب', participation: 'مشاركة',
             project: 'مشروع', behavior: 'سلوك' }[k] || k || '—';
  }

  function subjectBar(s) {
    var tone = s.average >= 85 ? '' : s.average >= 70 ? '' : s.average >= 60 ? ' warn' : ' danger';
    return '<div style="margin-bottom:1rem">' +
      '<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.4rem">' +
      '<span style="font-size:.87rem;font-weight:600">' + E(s.subject_name) + '</span>' +
      '<span style="margin-inline-start:auto;font-size:.85rem;font-weight:800">' + E(s.average) + '%</span></div>' +
      '<div class="edu-bar' + tone + '"><span style="width:' + Math.min(100, s.average) + '%"></span></div>' +
      '<div style="font-size:.72rem;color:var(--edu-muted);margin-top:.25rem">' + E(s.count) + ' تقييم</div></div>';
  }

  // 6) الحضور ───────────────────────────────────────────────────────────
  async function viewAttendance() {
    loading();
    try {
      var res = await Edu.data('attendance', { student_id: state.studentId });
      var rows = res.attendance || [];
      var s = res.summary || {};

      var html = '<div class="edu-grid c4" style="margin-bottom:1.25rem">' +
        stat('نسبة الحضور', s.rate != null ? s.rate + '%' : '—', 'خلال آخر فترة', s.rate >= 90 ? '' : 'amber') +
        stat('أيام الحضور', s.present || 0, 'من ' + (s.total || 0) + ' يوم دراسي', 'sky') +
        stat('الغياب', (s.absent || 0) + (s.excused || 0),
             (s.excused || 0) + ' بعذر · ' + (s.absent || 0) + ' بدون عذر', (s.absent ? 'red' : '')) +
        stat('التأخير', s.late || 0, 'مرات الوصول المتأخر', 'amber') +
        '</div>';

      var notable = rows.filter(function (r) { return r.status !== 'present'; });
      html += '<div class="edu-card"><div class="edu-card-head"><h2>✅ سجل الغياب والتأخير</h2></div>';
      if (!notable.length) {
        html += '<div class="edu-empty"><div class="ico">🌟</div><p>سجل حضور مثالي — لا غياب ولا تأخير</p></div>';
      } else {
        html += '<div class="edu-list">' + notable.map(function (r) {
          return row('<span class="edu-dot">' + (r.status === 'late' ? '⏰' : '🚫') + '</span>',
            E(Edu.fmtDate(r.date)), E(r.note || Edu.weekdayName(new Date(r.date + 'T00:00:00').getDay())),
            '<span class="edu-badge ' + Edu.tone(Edu.ATT_LABELS, r.status) + '">' +
            E(Edu.label(Edu.ATT_LABELS, r.status)) + '</span>');
        }).join('') + '</div>';
      }
      viewEl.innerHTML = html + '</div>';
    } catch (e) { fail(e); }
  }

  // 7) الإعلانات ────────────────────────────────────────────────────────
  async function viewAnnouncements() {
    loading();
    try {
      var res = await Edu.data('announcements', {});
      var list = res.announcements || [];
      viewEl.innerHTML = '<div class="edu-card"><div class="edu-card-head"><h2>📢 إعلانات المدرسة</h2></div>' +
        (list.length
          ? '<div class="edu-list">' + list.map(annRow).join('') + '</div>'
          : '<div class="edu-empty"><div class="ico">📭</div><p>لا توجد إعلانات</p></div>') + '</div>';
    } catch (e) { fail(e); }
  }

  function annRow(a) {
    return '<div class="edu-row"><span class="edu-dot">' + (a.pinned ? '📌' : '📢') + '</span>' +
      '<div class="edu-row-main"><div class="edu-row-title">' + E(a.title) + '</div>' +
      (a.body ? '<div class="edu-row-sub" style="margin-top:.25rem">' + E(a.body) + '</div>' : '') +
      '<div class="edu-row-sub" style="margin-top:.3rem;opacity:.8">' + E(Edu.fmtDate(a.created_at)) + '</div>' +
      '</div></div>';
  }

  // 8) التواصل ──────────────────────────────────────────────────────────
  async function viewMessages() {
    loading();
    try {
      var res = await Edu.data('messages', {});
      var people = {};
      (res.people || []).concat(res.contacts || []).forEach(function (p) { people[p.id] = p; });
      var contacts = res.contacts || [];

      var html = '<div class="edu-card"><div class="edu-card-head"><h2>💬 التواصل مع المعلمين والإدارة</h2></div>' +
        '<div class="edu-alert info">' + (IS_STUDENT
          ? 'راسل معلميك وإدارة المدرسة مباشرة — كل رسالة موثّقة لدى المدرسة.'
          : 'التواصل الرسمي يُحفظ هنا بدلاً من قروبات الواتساب — كل رسالة مرتبطة بابنك وموثّقة لدى المدرسة.') + '</div>';

      html += '<div class="edu-chat" id="chatBox">';
      if (!(res.messages || []).length) {
        html += '<div class="edu-empty"><div class="ico">💬</div><p>لا توجد رسائل بعد</p></div>';
      } else {
        html += res.messages.map(function (m) {
          var mine = m.from_user_id === session.user.id;
          var who = people[m.from_user_id];
          return '<div class="edu-msg ' + (mine ? 'me' : 'them') + '">' +
            (mine ? '' : '<strong style="display:block;font-size:.76rem;margin-bottom:.2rem">' +
              E(who ? who.full_name : 'المدرسة') + '</strong>') +
            E(m.body) + '<time>' + E(Edu.fmtShort(m.created_at)) + '</time></div>';
        }).join('');
      }
      html += '</div>';

      html += '<div style="display:flex;gap:.6rem;margin-top:1rem;flex-wrap:wrap">' +
        '<select class="edu-field" id="toUser" style="flex:1;min-width:180px;margin:0;padding:.7rem;border:1.5px solid var(--edu-line);border-radius:11px;font-family:inherit">' +
        contacts.map(function (c) {
          return '<option value="' + E(c.id) + '">' + E(c.full_name) +
            (c.role === 'school_admin' ? ' (الإدارة)' : '') + '</option>';
        }).join('') + '</select></div>' +
        '<div class="edu-field" style="margin-top:.6rem"><textarea id="msgBody" placeholder="اكتب رسالتك للمعلم أو الإدارة..."></textarea></div>' +
        '<button class="edu-btn green" id="sendMsg">إرسال</button>';

      viewEl.innerHTML = html + '</div>';

      var box = document.getElementById('chatBox');
      if (box) box.scrollTop = box.scrollHeight;

      document.getElementById('sendMsg').onclick = async function () {
        var body = document.getElementById('msgBody').value.trim();
        var to = document.getElementById('toUser').value;
        if (!body || !to) return Edu.toast('اكتب الرسالة واختر المستلم');
        this.disabled = true;
        try {
          await Edu.data('send_message', { to_user_id: to, body: body, student_id: state.studentId });
          Edu.toast('تم إرسال الرسالة');
          viewMessages();
        } catch (e) { Edu.toast(e.message); this.disabled = false; }
      };
    } catch (e) { fail(e); }
  }

  // ── أدوات بناء HTML ──────────────────────────────────────────────────
  function stat(lbl, val, hint, cls) {
    return '<div class="edu-stat ' + (cls || '') + '"><div class="lbl">' + E(lbl) + '</div>' +
      '<div class="val">' + E(val) + '</div><div class="hint">' + E(hint || '') + '</div></div>';
  }

  function row(icon, title, sub, end) {
    return '<div class="edu-row">' + icon + '<div class="edu-row-main">' +
      '<div class="edu-row-title">' + title + '</div>' +
      '<div class="edu-row-sub">' + sub + '</div></div>' +
      '<div class="edu-row-end">' + (end || '') + '</div></div>';
  }

  function wireNav() {
    Array.prototype.forEach.call(viewEl.querySelectorAll('[data-nav]'), function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); go(a.getAttribute('data-nav')); });
    });
  }

  // ── الإقلاع ──────────────────────────────────────────────────────────
  var initial = (location.hash || '').replace('#', '');
  go(TITLES[initial] ? initial : 'overview');
})();
