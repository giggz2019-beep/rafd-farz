'use strict';
(function () {
  var currentStep = 1;
  var nafathVerified = false;
  var fileAttached = false;
  var terminalInterval = null;

  function openModal() {
    document.getElementById('modalOverlay').classList.add('active');
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    document.getElementById('modalOverlay').classList.remove('active');
    document.body.style.overflow = '';
  }

  function simulateNafath() {
    var btn = document.querySelector('.nafath-btn');
    btn.innerHTML = '⏳ جارٍ التحقق...';
    btn.disabled = true;
    btn.style.opacity = '0.7';
    setTimeout(function () {
      document.getElementById('nafathBox').style.display = 'none';
      document.getElementById('nafathVerified').classList.add('show');
      nafathVerified = true;
      document.getElementById('btnNext').style.background = '#16a34a';
      document.getElementById('btnNext').innerHTML = 'التالي ← ✓';
    }, 2200);
  }

  function handleFileSelect(e) {
    var file = e.target.files[0];
    if (file) setFile(file);
  }
  function handleDragOver(e) {
    e.preventDefault();
    document.getElementById('uploadArea').classList.add('dragover');
  }
  function handleDragLeave() {
    document.getElementById('uploadArea').classList.remove('dragover');
  }
  function handleDrop(e) {
    e.preventDefault();
    document.getElementById('uploadArea').classList.remove('dragover');
    var file = e.dataTransfer.files[0];
    if (file) setFile(file);
  }
  function setFile(file) {
    var sizeKB = (file.size / 1024).toFixed(0);
    var sizeMB = (file.size / 1024 / 1024).toFixed(2);
    document.getElementById('fileName').textContent = file.name;
    document.getElementById('fileSize').textContent = file.size > 1024 * 1024 ? sizeMB + ' MB' : sizeKB + ' KB';
    document.getElementById('fileSelected').classList.add('show');
    fileAttached = true;
    document.getElementById('btnSubmit').style.background = 'linear-gradient(135deg, #16a34a, #15803d)';
  }
  function removeFile() {
    document.getElementById('cvFile').value = '';
    document.getElementById('fileSelected').classList.remove('show');
    fileAttached = false;
  }

  function nextStep() {
    if (currentStep === 1 && !nafathVerified) { alert('يرجى التحقق من هويتك عبر نفاذ أولاً'); return; }
    if (currentStep === 2) {
      var email = document.getElementById('f_email').value;
      var phone = document.getElementById('f_phone').value;
      var title = document.getElementById('f_title').value;
      var motivation = document.getElementById('f_motivation').value;
      if (!email || !phone || !title || !motivation) { alert('يرجى تعبئة جميع الحقول الإلزامية'); return; }
    }
    if (currentStep < 3) { currentStep++; updateStepUI(); }
  }
  function prevStep() {
    if (currentStep > 1) { currentStep--; updateStepUI(); }
  }
  function updateStepUI() {
    document.querySelectorAll('.form-step').forEach(function (s) { s.classList.remove('active'); });
    document.getElementById('step' + currentStep).classList.add('active');
    var pct = (currentStep / 3) * 100;
    document.getElementById('progressFill').style.width = pct + '%';
    for (var i = 1; i <= 3; i++) {
      var dot = document.getElementById('dot' + i);
      dot.classList.remove('active', 'done');
      if (i < currentStep) { dot.classList.add('done'); dot.innerHTML = '✓'; }
      else if (i === currentStep) { dot.classList.add('active'); dot.innerHTML = i; }
      else dot.innerHTML = i;
    }
    var subtitles = ['الخطوة 1 من 3 — التحقق من الهوية', 'الخطوة 2 من 3 — المعلومات الشخصية', 'الخطوة 3 من 3 — رفع السيرة الذاتية'];
    document.getElementById('modalSubtitle').textContent = subtitles[currentStep - 1];
    document.getElementById('footerInfo').textContent = 'الخطوة ' + currentStep + ' من 3';
    document.getElementById('btnBack').style.display = currentStep > 1 ? 'flex' : 'none';
    document.getElementById('btnNext').style.display = currentStep < 3 ? 'flex' : 'none';
    document.getElementById('btnSubmit').style.display = currentStep === 3 ? 'flex' : 'none';
    document.getElementById('btnNext').style.background = '';
    document.getElementById('btnNext').innerHTML = 'التالي ←';
  }

  function submitApplication() {
    document.getElementById('formBody').style.display = 'none';
    document.getElementById('modalFooter').style.display = 'none';
    document.getElementById('aiProcessing').classList.add('active');
    document.querySelector('.modal-header').style.background = 'linear-gradient(135deg, #0d1117, #1f2937)';
    document.getElementById('modalSubtitle').textContent = 'جارٍ التحليل بالذكاء الاصطناعي...';
    runTerminal();
  }

  function runTerminal() {
    var lines = [
      { text: '$ بدء جلسة تحليل جديدة — Session ID: RFD-2026-' + Math.floor(Math.random() * 90000 + 10000), type: 'info', delay: 400 },
      { text: '✓ التحقق من هوية المتقدم عبر نفاذ (سدايا)... ✓ موثّق', type: 'done', delay: 900 },
      { text: '✓ استيراد بيانات نفاذ: محمد عبدالله الغامدي | 1098765432', type: 'done', delay: 1400 },
      { text: '$ جارٍ قراءة ملف السيرة الذاتية PDF...', type: 'info', delay: 2000 },
      { text: '✓ تم استخراج النص: 847 كلمة | 3 صفحات', type: 'done', delay: 2600 },
      { text: '$ تحليل المؤهلات الأكاديمية...', type: 'info', delay: 3100 },
      { text: '✓ المؤهل: بكالوريوس هندسة البرمجيات — جامعة الملك عبدالله', type: 'done', delay: 3700 },
      { text: '$ تحليل سنوات الخبرة...', type: 'info', delay: 4200 },
      { text: '✓ الخبرة المستخرجة: 4.5 سنة في تطوير البرمجيات', type: 'done', delay: 4800 },
      { text: '$ فحص المهارات التقنية...', type: 'info', delay: 5300 },
      { text: '✓ React ✓ Node.js ✓ TypeScript ✓ PostgreSQL ✓ Docker', type: 'done', delay: 5900 },
      { text: '⚠ AWS / Cloud: غير مذكور صراحةً في السيرة الذاتية', type: 'warn', delay: 6400 },
      { text: '$ تحليل الإنجازات والمشاريع...', type: 'info', delay: 6900 },
      { text: '✓ 3 مشاريع موثّقة | إنجاز بارز: تطوير منصة AI بـ 2000+ مستخدم', type: 'done', delay: 7500 },
      { text: '$ فحص الشهادات المهنية...', type: 'info', delay: 8000 },
      { text: '✓ AWS Certified Developer — Associate (2024)', type: 'done', delay: 8600 },
      { text: '$ مقارنة المؤهلات بمعايير الجهة...', type: 'info', delay: 9100 },
      { text: '$ حساب الدرجة النهائية...', type: 'info', delay: 9700 },
      { text: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', type: 'bold', delay: 10200 },
      { text: '✓ التحليل مكتمل — الدرجة النهائية: 84/100 | تقدير B+', type: 'done', delay: 10700 },
      { text: '✓ القرار: مجتاز — يتجاوز نسبة الاجتياز (80%)', type: 'done', delay: 11200 },
    ];
    var i = 0;
    var body = document.getElementById('terminalBody');
    body.innerHTML = '';
    function addLine() {
      if (i >= lines.length) { setTimeout(showResult, 800); return; }
      var line = lines[i];
      var div = document.createElement('div');
      div.className = 'terminal-line ' + line.type;
      div.textContent = line.text;
      body.appendChild(div);
      body.scrollTop = body.scrollHeight;
      i++;
      setTimeout(addLine, lines[i] ? (lines[i].delay - line.delay) : 800);
    }
    setTimeout(addLine, lines[0].delay);
  }

  function showResult() {
    document.getElementById('aiProcessing').classList.remove('active');
    document.getElementById('resultSection').classList.add('active');
    document.querySelector('.modal-header').style.background = '';
    var score = 84; var threshold = 80; var passed = score >= threshold;
    document.getElementById('modalSubtitle').textContent = passed ? '✓ تهانينا! اجتزت معايير القبول' : 'نتيجة التقييم';
    var card = document.getElementById('resultCard');
    card.className = 'result-card ' + (passed ? 'pass' : 'fail');
    document.getElementById('resultIcon').textContent = passed ? '🎉' : '📋';
    document.getElementById('resultTitle').textContent = passed ? 'مبروك! اجتزت الفحص الأولي' : 'لم تستوفِ معايير القبول';
    document.getElementById('resultSubtitle').textContent = passed
      ? 'طلبك سيُحوَّل لمسؤول التوظيف خلال 24 ساعة للمراجعة النهائية'
      : 'درجتك لم تصل لنسبة الاجتياز المحددة من الجهة. يمكنك إعادة التقديم في الدورة القادمة.';
    document.getElementById('scoreNum').textContent = score;
    var ring = document.getElementById('ringFill');
    ring.className = passed ? 'ring-fill-pass' : 'ring-fill-fail';
    var circumference = 264;
    var offset = circumference - (score / 100) * circumference;
    setTimeout(function () { ring.style.strokeDashoffset = offset; }, 200);
    var items = [
      { label: 'المؤهل الأكاديمي', score: 20, max: 20, note: 'بكالوريوس هندسة البرمجيات ✓' },
      { label: 'سنوات الخبرة', score: 18, max: 20, note: '4.5 سنة — يستوفي الحد الأدنى ✓' },
      { label: 'المهارات التقنية', score: 22, max: 25, note: 'React, Node.js, TypeScript ✓ | AWS جزئي ⚠' },
      { label: 'الشهادات المهنية', score: 12, max: 15, note: 'AWS Developer Associate ✓' },
      { label: 'الإنجازات والمشاريع', score: 12, max: 20, note: '3 مشاريع موثّقة' },
    ];
    var html = '';
    items.forEach(function (item) {
      var pct = Math.round((item.score / item.max) * 100);
      var cls = pct >= 80 ? 'pass' : pct >= 50 ? 'warn' : 'fail';
      html += '<div class="score-item"><div class="score-item-icon ' + cls + '">' + (cls === 'pass' ? '✓' : cls === 'warn' ? '⚠' : '✕') + '</div><div style="flex:1;"><div class="score-item-label">' + item.label + '</div><div style="font-size:0.72rem; color:var(--gray-400); margin-top:2px;">' + item.note + '</div></div><div class="score-item-bar"><div class="score-item-fill fill-' + cls + '" style="width:' + pct + '%"></div></div><div class="score-item-pct pct-' + cls + '">' + item.score + '/' + item.max + '</div></div>';
    });
    document.getElementById('scoreItems').innerHTML = html;
    document.getElementById('thresholdNote').innerHTML = '<strong>💡 ملاحظة تجريبية:</strong> في هذا المثال، نسبة الاجتياز المحددة من الجهة هي <strong>' + threshold + '%</strong>. درجتك <strong>' + score + '/100</strong> ' + (passed ? 'تتجاوز' : 'لا تصل إلى') + ' هذه النسبة. في النظام الحقيقي، كل جهة تُحدد نسبة الاجتياز الخاصة بها — سواء كانت 70% أو 85% أو 90%. فقط المتأهلون يُحوَّلون لمسؤول التوظيف.';
  }

  function resetDemo() {
    currentStep = 1; nafathVerified = false; fileAttached = false;
    document.getElementById('formBody').style.display = '';
    document.getElementById('modalFooter').style.display = '';
    document.getElementById('aiProcessing').classList.remove('active');
    document.getElementById('resultSection').classList.remove('active');
    document.querySelector('.modal-header').style.background = '';
    document.getElementById('nafathBox').style.display = '';
    document.getElementById('nafathVerified').classList.remove('show');
    var nafathBtn = document.querySelector('.nafath-btn');
    nafathBtn.innerHTML = '<span>🔐</span> تسجيل الدخول عبر نفاذ';
    nafathBtn.disabled = false; nafathBtn.style.opacity = '';
    removeFile();
    document.querySelectorAll('.form-step').forEach(function (s) { s.classList.remove('active'); });
    document.getElementById('step1').classList.add('active');
    updateStepUI();
    document.getElementById('btnBack').style.display = 'none';
    document.getElementById('btnNext').style.display = 'flex';
    document.getElementById('btnSubmit').style.display = 'none';
    document.getElementById('progressFill').style.width = '33%';
    for (var i = 1; i <= 3; i++) {
      var dot = document.getElementById('dot' + i);
      dot.classList.remove('active', 'done'); dot.innerHTML = i;
      if (i === 1) dot.classList.add('active');
    }
    document.getElementById('modalSubtitle').textContent = 'الخطوة 1 من 3 — التحقق من الهوية';
  }

  // Radio/checkbox highlight
  document.querySelectorAll('.radio-option input, .check-option input').forEach(function (input) {
    input.addEventListener('change', function () {
      if (this.type === 'radio') {
        var name = this.name;
        document.querySelectorAll('input[name="' + name + '"]').forEach(function (r) {
          var p = r.closest('.radio-option');
          if (p) p.classList.remove('selected');
        });
      }
      var parent = this.closest('.radio-option, .check-option');
      if (parent) {
        if (this.type === 'checkbox') parent.classList.toggle('selected', this.checked);
        else parent.classList.add('selected');
      }
    });
  });

  // ===== EVENT BINDINGS =====
  document.querySelectorAll('.hero-cta, .apply-btn').forEach(function (el) {
    el.addEventListener('click', openModal);
  });

  var modalOverlay = document.getElementById('modalOverlay');
  if (modalOverlay) {
    modalOverlay.addEventListener('click', function (e) {
      if (e.target === modalOverlay) closeModal();
    });
  }

  var modalClose = document.querySelector('.modal-close');
  if (modalClose) modalClose.addEventListener('click', closeModal);

  var nafathBtn = document.querySelector('.nafath-btn');
  if (nafathBtn) nafathBtn.addEventListener('click', simulateNafath);

  var uploadArea = document.getElementById('uploadArea');
  if (uploadArea) {
    uploadArea.addEventListener('dragover', handleDragOver);
    uploadArea.addEventListener('dragleave', handleDragLeave);
    uploadArea.addEventListener('drop', handleDrop);
  }
  var cvFile = document.getElementById('cvFile');
  if (cvFile) cvFile.addEventListener('change', handleFileSelect);

  var fileRemove = document.querySelector('.file-remove');
  if (fileRemove) fileRemove.addEventListener('click', removeFile);

  var btnBack = document.getElementById('btnBack');
  if (btnBack) btnBack.addEventListener('click', prevStep);
  var btnNext = document.getElementById('btnNext');
  if (btnNext) btnNext.addEventListener('click', nextStep);
  var btnSubmit = document.getElementById('btnSubmit');
  if (btnSubmit) btnSubmit.addEventListener('click', submitApplication);

  var resetBtn = document.querySelector('.btn-outline-result');
  if (resetBtn) resetBtn.addEventListener('click', resetDemo);
})();
