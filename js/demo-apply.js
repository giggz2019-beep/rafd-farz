'use strict';
(function () {
  var curStep = 0;

  function showModal() {
    document.getElementById('modal').classList.add('show');
  }

  function startApp() {
    document.getElementById('modal').classList.remove('show');
    document.getElementById('welcomeWrap').style.display = 'none';
    document.getElementById('progWrap').style.display = 'block';
    go(1);
  }

  function go(n) {
    [1, 2, 3, 4].forEach(function (i) { document.getElementById('s' + i).classList.remove('show'); });
    document.getElementById('s' + n).classList.add('show');
    curStep = n;
    updateProg(n);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function updateProg(n) {
    document.getElementById('progFill').style.width = (n * 25) + '%';
    [1, 2, 3, 4].forEach(function (i) {
      var sc = document.getElementById('sc' + i);
      var sl = document.getElementById('sl' + i);
      var ln = document.getElementById('ln' + i);
      if (i < n) {
        sc.className = 'ps-circle done'; sc.textContent = '✓';
        sl.className = 'ps-label'; if (ln) ln.className = 'ps-line done';
      } else if (i === n) {
        sc.className = 'ps-circle active'; sc.textContent = i;
        sl.className = 'ps-label active';
      } else {
        sc.className = 'ps-circle idle'; sc.textContent = i;
        sl.className = 'ps-label';
      }
    });
  }

  function selR(el, gid, val) {
    document.getElementById(gid).querySelectorAll('.ropt').forEach(function (o) { o.classList.remove('sel'); });
    el.classList.add('sel');
  }

  function togC(el) { el.classList.toggle('sel'); }

  function toast(msg) {
    var t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);background:#1a3a4a;color:#fff;padding:.7rem 1.4rem;border-radius:12px;font-family:Almarai,sans-serif;font-size:.85rem;z-index:500;box-shadow:0 8px 24px rgba(0,0,0,.2)';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3000);
  }

  function collect() {
    var name = document.getElementById('f_name').value || 'المتقدم';
    var sector = document.getElementById('f_sector').value;
    var exp = parseInt(document.getElementById('f_exp').dataset.v || 3);
    var team = document.getElementById('f_team').value;
    var edu = document.querySelector('input[name="edu"]:checked') ? document.querySelector('input[name="edu"]:checked').value : null;
    var prev = document.querySelector('input[name="prev"]:checked') ? document.querySelector('input[name="prev"]:checked').value : null;
    var stage = document.querySelector('input[name="stage"]:checked') ? document.querySelector('input[name="stage"]:checked').value : null;
    var cust = document.querySelector('input[name="cust"]:checked') ? document.querySelector('input[name="cust"]:checked').value : null;
    var commit = document.querySelector('input[name="commit"]:checked') ? document.querySelector('input[name="commit"]:checked').value : null;

    var score = 0; var bd = [];
    var eduS = { phd: 15, master: 12, bachelor: 9, diploma: 5 }[edu] || 7;
    score += eduS; bd.push({ l: 'المؤهل الأكاديمي', s: eduS, m: 15, p: eduS >= 9 });
    var expS = Math.min(20, exp * 2);
    score += expS; bd.push({ l: 'سنوات الخبرة (' + exp + ' سنوات)', s: expS, m: 20, p: expS >= 10 });
    var prevS = { yes_exit: 15, yes_active: 12, yes_closed: 8, no: 4 }[prev] || 4;
    score += prevS; bd.push({ l: 'الخبرة الريادية السابقة', s: prevS, m: 15, p: prevS >= 8 });
    var stageS = { growth: 20, revenue: 17, mvp: 12, idea: 6 }[stage] || 6;
    score += stageS; bd.push({ l: 'مرحلة المشروع', s: stageS, m: 20, p: stageS >= 12 });
    var custS = { paying: 15, free: 10, pilot: 7, none: 2 }[cust] || 2;
    score += custS; bd.push({ l: 'وجود عملاء حاليين', s: custS, m: 15, p: custS >= 7 });
    var teamS = { '6+': 10, '3-5': 8, '2': 6, '1': 4 }[team] || 4;
    score += teamS; bd.push({ l: 'حجم الفريق', s: teamS, m: 10, p: teamS >= 6 });
    var commitS = { yes: 5, maybe: 2, no: 0 }[commit] || 0;
    score += commitS; bd.push({ l: 'الالتزام بمتطلبات البرنامج', s: commitS, m: 5, p: commitS >= 3 });

    var accepted = score >= 55;
    var grade = score >= 85 ? 'A+' : score >= 75 ? 'A' : score >= 65 ? 'B+' : score >= 55 ? 'B' : score >= 45 ? 'C' : 'D';
    var sectorName = { fintech: 'التقنية المالية', health: 'الصحة', edu: 'التعليم', ecom: 'التجارة الإلكترونية', ai: 'الذكاء الاصطناعي', logistics: 'اللوجستيات', other: 'أخرى' }[sector] || 'التقنية';
    return { name: name, score: score, grade: grade, accepted: accepted, bd: bd, sectorName: sectorName };
  }

  function submit() {
    [1, 2, 3, 4].forEach(function (i) { document.getElementById('s' + i).classList.remove('show'); });
    document.getElementById('progWrap').style.display = 'none';
    document.getElementById('aiPage').classList.add('show');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    var data = collect();
    runTerminal(data);
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function runTerminal(data) {
    var body = document.getElementById('termBody');
    var prog = document.getElementById('tProg');
    var safeName = escapeHtml(data.name);
    var safeSector = escapeHtml(data.sectorName);
    var lines = [
      { t: 'جارٍ البحث في قاعدة البيانات عن <span class="hi">' + safeName + '</span>...', d: 500 },
      { t: 'التحقق من هوية المتقدم عبر <span class="hi">نفاذ</span> <span class="bl">(سدايا)</span>... ✓', d: 1100 },
      { t: 'تحليل قطاع <span class="hi">' + safeSector + '</span> ومعايير السوق...', d: 1800 },
      { t: 'استدعاء نموذج التقييم <span class="hi">Rafd-AI v2.4</span>...', d: 2500 },
      { t: 'تحليل المؤهلات الأكاديمية والخبرة العملية...', d: 3200 },
      { t: 'تقييم مرحلة المشروع وجاهزيته للسوق...', d: 3900 },
      { t: 'فحص سجل المؤسس والمشاريع السابقة...', d: 4600 },
      { t: 'تحليل حجم الفريق وتوزيع المهارات...', d: 5300 },
      { t: 'مقارنة الطلب مع <span class="wa">+2,847</span> طلب سابق في قاعدة البيانات...', d: 6000 },
      { t: 'تطبيق معايير البرنامج على البيانات المُجمَّعة...', d: 6700 },
      { t: 'حساب الدرجة النهائية وإعداد التقرير التفصيلي...', d: 7400 },
      { t: '<span class="hi">✓ اكتمل التحليل — الدرجة: ' + data.score + '/100 — ' + (data.accepted ? 'مقبول ✓' : 'مرفوض ✗') + '</span>', d: 8100 },
    ];
    lines.forEach(function (line, i) {
      setTimeout(function () {
        var el = document.createElement('div');
        el.className = 'tl';
        var ic = document.createElement('div');
        ic.className = 'tl-icon ok';
        ic.textContent = i < lines.length - 1 ? '✓' : (data.accepted ? '✓' : '✗');
        if (!data.accepted && i === lines.length - 1) ic.style.background = '#ef4444';
        var tx = document.createElement('div');
        tx.className = 'tl-text';
        tx.innerHTML = line.t;
        el.appendChild(ic); el.appendChild(tx);
        body.appendChild(el);
        setTimeout(function () { el.classList.add('show'); }, 50);
        prog.style.width = ((i + 1) / lines.length * 100) + '%';
      }, line.d);
    });
    setTimeout(function () {
      document.getElementById('aiPage').classList.remove('show');
      showResult(data);
    }, 9000);
  }

  function showResult(data) {
    var rp = document.getElementById('resultPage');
    rp.classList.add('show');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    var refNum = 'RAFD-' + Date.now().toString().slice(-8);
    var today = new Date().toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' });
    var hero = document.getElementById('rHero');
    var safeName = escapeHtml(data.name);
    var safeSector = escapeHtml(data.sectorName);

    if (data.accepted) {
      hero.innerHTML = '<div class="result-hero accepted"><div class="rh-trophy">🏆</div><div class="rh-title">تهانينا ' + safeName + '!</div><div class="rh-sub">تم قبول طلبك بنجاح</div><div class="score-box"><div class="sb-label">درجتك النهائية</div><div class="sb-score">' + data.score + '</div><div class="sb-grade">تقدير ' + data.grade + '</div></div></div><div class="cert-card accepted-cert"><div class="cert-header"><div class="cert-logo-wrap"><img src="/images/rafd-logo.jpg" alt="RAFD" class="cert-logo"><span class="cert-brand">RAFD</span></div><div class="cert-badge-accepted">✔ مقبول</div></div><div class="cert-divider"></div><div class="cert-body"><div class="cert-label">بطاقة قبول رسمية</div><div class="cert-name">' + safeName + '</div><div class="cert-detail">تم قبول طلبك في برنامج <strong>دعم الشركات الناشئة</strong></div><div class="cert-detail">قطاع: <strong>' + safeSector + '</strong></div><div class="cert-score-row"><div class="cert-score-item"><div class="csi-val">' + data.score + '/100</div><div class="csi-lbl">الدرجة</div></div><div class="cert-score-item"><div class="csi-val">' + data.grade + '</div><div class="csi-lbl">التقدير</div></div><div class="cert-score-item"><div class="csi-val">✔ مقبول</div><div class="csi-lbl">القرار</div></div></div></div><div class="cert-divider"></div><div class="cert-footer"><div class="cert-ref">رقم الطلب: <strong>' + refNum + '</strong></div><div class="cert-date">تاريخ التقييم: ' + today + '</div><div class="cert-powered">معتمد بذكاء اصطناعي RAFD ⚡</div></div></div>';
      launchConfetti();
    } else {
      hero.innerHTML = '<div class="result-hero rejected"><div class="rh-trophy">📋</div><div class="rh-title">شكراً لتقديمك، ' + safeName + '</div><div class="rh-sub">للأسف لم يستوفِ طلبك معايير القبول في هذه الدورة</div><div class="score-box"><div class="sb-label">درجتك النهائية</div><div class="sb-score">' + data.score + '</div><div class="sb-grade">تقدير ' + data.grade + '</div></div></div><div class="cert-card rejected-cert"><div class="cert-header"><div class="cert-logo-wrap"><img src="/images/rafd-logo.jpg" alt="RAFD" class="cert-logo"><span class="cert-brand">RAFD</span></div><div class="cert-badge-rejected">✕ غير مقبول</div></div><div class="cert-divider"></div><div class="cert-body"><div class="cert-label">إشعار رسمي</div><div class="cert-name">' + safeName + '</div><div class="cert-detail">بعد مراجعة طلبك في برنامج <strong>دعم الشركات الناشئة</strong></div><div class="cert-detail cert-sorry">نعتذر بصدق عن عدم استيفاء طلبك للمعايير المطلوبة في هذه الدورة. نتمنى لك التوفيق ونشجعك على تطوير مشروعك والتقديم مجدداً في الدورة القادمة.</div><div class="cert-score-row"><div class="cert-score-item"><div class="csi-val">' + data.score + '/100</div><div class="csi-lbl">الدرجة</div></div><div class="cert-score-item"><div class="csi-val">' + data.grade + '</div><div class="csi-lbl">التقدير</div></div><div class="cert-score-item"><div class="csi-val">✕ مرفوض</div><div class="csi-lbl">القرار</div></div></div></div><div class="cert-divider"></div><div class="cert-footer"><div class="cert-ref">رقم الطلب: <strong>' + refNum + '</strong></div><div class="cert-date">تاريخ التقييم: ' + today + '</div><div class="cert-powered">معتمد بذكاء اصطناعي RAFD ⚡</div></div></div>';
    }

    var rl = document.getElementById('rReasons');
    data.bd.forEach(function (item) {
      var pct = Math.round(item.s / item.m * 100);
      rl.innerHTML += '<div class="reason-item ' + (item.p ? 'pos' : 'neg') + '"><div class="ri-icon">' + (item.p ? '✅' : '⚠️') + '</div><div class="ri-text"><span class="ri-badge">' + item.s + '/' + item.m + '</span><strong>' + item.l + '</strong> — ' + (item.p ? 'يستوفي المعيار المطلوب' : 'يحتاج تحسيناً') + ' (' + pct + '%)</div></div>';
    });
  }

  function launchConfetti() {
    var c = document.getElementById('confetti');
    var cols = ['#10b981', '#1a3a4a', '#f59e0b', '#ef4444', '#8b5cf6', '#3b82f6', '#ec4899'];
    for (var i = 0; i < 90; i++) {
      var p = document.createElement('div');
      p.className = 'cp';
      p.style.cssText = 'left:' + (Math.random() * 100) + '%;background:' + cols[Math.floor(Math.random() * cols.length)] + ';width:' + (6 + Math.random() * 8) + 'px;height:' + (6 + Math.random() * 8) + 'px;border-radius:' + (Math.random() > .5 ? '50%' : '2px') + ';animation-duration:' + (2 + Math.random() * 3) + 's;animation-delay:' + (Math.random() * 1.5) + 's;';
      c.appendChild(p);
    }
    setTimeout(function () { c.innerHTML = ''; }, 6000);
  }

  // ===== EVENT BINDINGS =====
  var btnModal = document.querySelector('.btn-modal');
  if (btnModal) btnModal.addEventListener('click', startApp);
  var btnStart = document.querySelector('.btn-start');
  if (btnStart) btnStart.addEventListener('click', showModal);

  // Step navigation buttons via data-go attribute
  document.querySelectorAll('[data-go]').forEach(function (el) {
    el.addEventListener('click', function () { go(parseInt(el.dataset.go)); });
  });
  var btnSubmit = document.querySelector('#s4 .btn-submit');
  if (btnSubmit) btnSubmit.addEventListener('click', submit);

  // Range input
  var expRange = document.getElementById('f_exp');
  if (expRange) {
    expRange.addEventListener('input', function () {
      document.getElementById('expV').textContent = this.value + ' سنوات';
      this.dataset.v = this.value;
    });
  }

  // Radio option labels
  document.querySelectorAll('.ropt[data-group]').forEach(function (el) {
    el.addEventListener('click', function () { selR(el, el.dataset.group, el.dataset.val); });
  });

  // Checkbox option labels
  document.querySelectorAll('.copt[data-toggle]').forEach(function (el) {
    el.addEventListener('click', function () { togC(el); });
  });

  // Upload zone
  var uploadZone = document.getElementById('uploadZoneDemo');
  if (uploadZone) uploadZone.addEventListener('click', function () { toast('رفع الملفات متاح في النسخة الكاملة'); });
})();
