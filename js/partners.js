'use strict';
(function () {
  // Logo error fallbacks (partners.html has its own navbar without shared navbar.js)
  var navLogoImg = document.querySelector('.nav-logo img');
  if (navLogoImg) {
    if (navLogoImg.complete && navLogoImg.naturalHeight === 0) navLogoImg.style.display = 'none';
    else navLogoImg.addEventListener('error', function () { navLogoImg.style.display = 'none'; });
  }
  var footerLogoImg = document.querySelector('.footer-logo img');
  if (footerLogoImg) {
    if (footerLogoImg.complete && footerLogoImg.naturalHeight === 0) footerLogoImg.style.display = 'none';
    else footerLogoImg.addEventListener('error', function () { footerLogoImg.style.display = 'none'; });
  }

  function selectFormType(el, type) {
    document.querySelectorAll('.type-opt').forEach(function (o) { o.classList.remove('selected'); });
    el.classList.add('selected');
    document.getElementById('selectedType').value = type;
  }

  function selectType(type) {
    document.getElementById('apply-form').scrollIntoView({ behavior: 'smooth' });
    setTimeout(function () {
      document.querySelectorAll('.type-opt').forEach(function (o) {
        if (o.dataset.type === type) {
          o.classList.add('selected');
          document.getElementById('selectedType').value = type;
        }
      });
    }, 600);
  }

  function submitPartnerForm() {
    var type = document.getElementById('selectedType').value;
    var org = document.getElementById('p_org').value.trim();
    var orgtype = document.getElementById('p_orgtype').value;
    var name = document.getElementById('p_name').value.trim();
    var title = document.getElementById('p_title').value.trim();
    var email = document.getElementById('p_email').value.trim();
    var phone = document.getElementById('p_phone').value.trim();
    var desc = document.getElementById('p_desc').value.trim();
    var agree = document.getElementById('agreeTerms').checked;

    if (!type) { alert('يرجى اختيار نوع الشراكة'); return; }
    if (!org) { alert('يرجى إدخال اسم الجهة'); return; }
    if (!name) { alert('يرجى إدخال الاسم الكامل'); return; }
    if (!email || !email.includes('@')) { alert('يرجى إدخال بريد إلكتروني صحيح'); return; }
    if (!phone) { alert('يرجى إدخال رقم الجوال'); return; }
    if (!desc) { alert('يرجى وصف الشراكة المقترحة'); return; }
    if (!agree) { alert('يرجى الموافقة على الشروط والأحكام'); return; }

    var btn = document.getElementById('submitBtn');
    btn.disabled = true;
    btn.textContent = 'جاري الإرسال...';

    setTimeout(function () {
      var partners = JSON.parse(localStorage.getItem('rafd_partners') || '[]');
      var refNum = 'RAFD-' + String(Date.now()).slice(-6);
      var newPartner = {
        id: Date.now(),
        ref: refNum,
        type: type,
        org: org,
        orgtype: orgtype,
        website: document.getElementById('p_website').value.trim(),
        name: name,
        title: title,
        email: email,
        phone: phone,
        desc: desc,
        capabilities: document.getElementById('p_capabilities').value.trim(),
        timeline: document.getElementById('p_timeline').value,
        status: 'pending',
        date: new Date().toISOString().split('T')[0]
      };
      partners.unshift(newPartner);
      localStorage.setItem('rafd_partners', JSON.stringify(partners));

      document.getElementById('formWrapper').style.display = 'none';
      document.getElementById('successWrapper').style.display = 'block';
      document.getElementById('successRef').textContent = 'رقم الطلب: #' + refNum;
      document.getElementById('apply-form').scrollIntoView({ behavior: 'smooth' });
    }, 1500);
  }

  function resetForm() {
    document.getElementById('formWrapper').style.display = 'block';
    document.getElementById('successWrapper').style.display = 'none';
    var btn = document.getElementById('submitBtn');
    btn.disabled = false;
    btn.textContent = 'إرسال طلب الشراكة الرسمي ←';
    document.querySelectorAll('.field-input').forEach(function (i) { i.value = ''; });
    document.getElementById('agreeTerms').checked = false;
    document.querySelectorAll('.type-opt').forEach(function (o) { o.classList.remove('selected'); });
    document.getElementById('selectedType').value = '';
  }

  // Type cards in hero section
  document.querySelectorAll('.type-card[data-type]').forEach(function (card) {
    card.addEventListener('click', function () { selectType(card.dataset.type); });
  });

  // Type option buttons in form
  document.querySelectorAll('.type-opt[data-type]').forEach(function (opt) {
    opt.addEventListener('click', function () { selectFormType(opt, opt.dataset.type); });
  });

  document.getElementById('submitBtn').addEventListener('click', submitPartnerForm);

  var resetLink = document.getElementById('resetFormLink');
  if (resetLink) {
    resetLink.addEventListener('click', function (e) {
      e.preventDefault();
      resetForm();
    });
  }
})();
