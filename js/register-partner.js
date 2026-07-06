'use strict';
(function () {
  var SUPABASE_URL = 'https://ycnnawohrbbluawxzttt.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_RgOring3FCEiBMGYPcPmZg_s_85Yc_f';
  var supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  // Logo onerror fallback
  var logoImg = document.querySelector('.register-logo img');
  if (logoImg) {
    logoImg.addEventListener('error', function () {
      var span = document.createElement('span');
      span.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:60px;height:60px;background:linear-gradient(135deg,#1a3a4a,#4a9d6f);border-radius:14px;color:#fff;font-weight:900;font-size:1.5rem;font-family:inherit';
      span.textContent = 'R';
      logoImg.parentElement.replaceChild(span, logoImg);
    });
  }

  var selectedPkg = 'basic';
  var timerInterval = null;
  var pendingPartner = null;

  function selectPkg(pkg) {
    selectedPkg = pkg;
    ['trial', 'basic', 'pro'].forEach(function (p) {
      document.getElementById('pkg_' + p).classList.toggle('selected', p === pkg);
    });
  }

  // Package card bindings
  document.querySelectorAll('.pkg-card[data-pkg]').forEach(function (el) {
    el.addEventListener('click', function () { selectPkg(el.dataset.pkg); });
  });

  // OTP digit auto-advance
  document.addEventListener('DOMContentLoaded', function () {
    for (var i = 0; i < 6; i++) {
      (function (idx) {
        var el = document.getElementById('otp' + idx);
        if (!el) return;
        el.addEventListener('input', function (e) {
          var val = e.target.value.replace(/\D/g, '');
          e.target.value = val;
          if (val && idx < 5) document.getElementById('otp' + (idx + 1)).focus();
          e.target.classList.toggle('filled', !!val);
        });
        el.addEventListener('keydown', function (e) {
          if (e.key === 'Backspace' && !e.target.value && idx > 0) {
            document.getElementById('otp' + (idx - 1)).focus();
          }
        });
        el.addEventListener('paste', function (e) {
          e.preventDefault();
          var paste = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6);
          for (var j = 0; j < paste.length; j++) {
            var d = document.getElementById('otp' + j);
            if (d) { d.value = paste[j]; d.classList.add('filled'); }
          }
          if (paste.length === 6) document.getElementById('verifyBtn').focus();
        });
      })(i);
    }
  });

  function startTimer(seconds) {
    clearInterval(timerInterval);
    var remaining = seconds;
    var timerEl = document.getElementById('otpTimer');
    var timerText = document.getElementById('otpTimerText');
    var resendBtn = document.getElementById('resendBtn');
    resendBtn.disabled = true;
    timerText.style.display = 'inline';
    timerInterval = setInterval(function () {
      remaining--;
      var m = Math.floor(remaining / 60);
      var s = remaining % 60;
      timerEl.textContent = m + ':' + String(s).padStart(2, '0');
      if (remaining <= 0) {
        clearInterval(timerInterval);
        timerText.style.display = 'none';
        resendBtn.disabled = false;
      }
    }, 1000);
  }

  async function submitForm() {
    var required = [
      { id: 'f_orgname', label: 'اسم الجهة' },
      { id: 'f_orgtype', label: 'نوع الجهة' },
      { id: 'f_city', label: 'المدينة' },
      { id: 'f_fname', label: 'الاسم الأول' },
      { id: 'f_lname', label: 'اسم العائلة' },
      { id: 'f_title', label: 'المسمى الوظيفي' },
      { id: 'f_phone', label: 'رقم الجوال' },
      { id: 'f_email', label: 'البريد الإلكتروني' },
      { id: 'f_pass', label: 'كلمة المرور' },
      { id: 'f_pass2', label: 'تأكيد كلمة المرور' },
    ];
    for (var f of required) {
      var el = document.getElementById(f.id);
      if (!el.value.trim()) {
        el.focus();
        el.style.borderColor = '#ef4444';
        setTimeout(function () { el.style.borderColor = ''; }, 2000);
        alert('يرجى إدخال: ' + f.label);
        return;
      }
    }
    var email = document.getElementById('f_email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { alert('يرجى إدخال بريد إلكتروني صحيح'); return; }
    var phone = document.getElementById('f_phone').value.trim();
    if (!/^05\d{8}$/.test(phone)) { alert('يرجى إدخال رقم جوال صحيح (مثال: 05XXXXXXXX)'); return; }
    var pass = document.getElementById('f_pass').value;
    var pass2 = document.getElementById('f_pass2').value;
    if (pass.length < 8) { alert('كلمة المرور يجب أن تكون 8 أحرف على الأقل'); return; }
    if (pass !== pass2) { alert('كلمة المرور وتأكيدها غير متطابقتين'); return; }
    if (!document.getElementById('chk_terms').checked) { alert('يرجى الموافقة على الشروط والأحكام'); return; }
    if (!document.getElementById('chk_privacy').checked) { alert('يرجى الموافقة على سياسة الخصوصية'); return; }

    var btn = document.getElementById('submitBtn');
    var btnText = document.getElementById('submitBtnText');
    btn.disabled = true;
    btnText.textContent = 'جاري التحقق...';

    try {
      var { data: existingPartner } = await supabase.from('partners').select('email').eq('email', email).maybeSingle();
      if (existingPartner) {
        alert('هذا البريد الإلكتروني مسجّل مسبقاً. يرجى تسجيل الدخول.');
        btn.disabled = false;
        btnText.textContent = 'إرسال رمز التفعيل';
        return;
      }
    } catch (e) { console.error('Supabase check error:', e); }

    btnText.textContent = 'جاري الإرسال...';
    var now = new Date();
    var refNum = 'RAFD-' + now.getFullYear() + '-' + String(Math.floor(Math.random() * 90000) + 10000);
    var priceMap = { trial: 0, basic: 499, pro: 999 };
    pendingPartner = {
      id: Date.now(), refNum,
      org: document.getElementById('f_orgname').value.trim(),
      orgtype: document.getElementById('f_orgtype').value,
      city: document.getElementById('f_city').value,
      website: document.getElementById('f_website').value.trim(),
      orgdesc: document.getElementById('f_orgdesc').value.trim(),
      fname: document.getElementById('f_fname').value.trim(),
      lname: document.getElementById('f_lname').value.trim(),
      title: document.getElementById('f_title').value.trim(),
      phone, email, password: btoa(pass),
      plan: selectedPkg, price: priceMap[selectedPkg],
      purpose: document.getElementById('f_purpose').value,
      volume: document.getElementById('f_volume').value,
      notes: document.getElementById('f_notes').value.trim(),
      status: 'approved',
      date: now.toLocaleDateString('ar-SA'), dateISO: now.toISOString(),
      totalRequests: 0, approvedRequests: 0, rejectedRequests: 0,
    };

    try {
      var { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
      if (error) throw error;
      document.getElementById('formSection').style.display = 'none';
      document.getElementById('otpSection').style.display = 'block';
      document.getElementById('otpEmailDisplay').textContent = email;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      startTimer(600);
      setTimeout(function () { document.getElementById('otp0').focus(); }, 300);
    } catch (err) {
      console.error('Supabase OTP error:', err);
      alert('حدث خطأ أثناء إرسال رمز التفعيل: ' + (err.message || 'يرجى المحاولة مرة أخرى'));
    } finally {
      btn.disabled = false;
      btnText.textContent = 'إرسال رمز التفعيل';
    }
  }

  async function verifyOTP() {
    var entered = [0, 1, 2, 3, 4, 5].map(function (i) { return document.getElementById('otp' + i).value; }).join('');
    if (entered.length < 6) { showOTPError('يرجى إدخال الرمز كاملاً (6 أرقام)'); return; }
    var verifyBtn = document.getElementById('verifyBtn');
    verifyBtn.disabled = true;
    verifyBtn.textContent = 'جاري التحقق...';
    var { data: authData, error: authError } = await supabase.auth.verifyOtp({
      email: pendingPartner.email, token: entered, type: 'email'
    });
    if (authError) {
      verifyBtn.disabled = false;
      verifyBtn.textContent = 'تحقق وفعّل الحساب ✓';
      showOTPError('رمز التفعيل غير صحيح أو منتهي الصلاحية، يرجى المحاولة مجدداً');
      var wrap = document.getElementById('otpInputWrap');
      wrap.style.animation = 'none'; wrap.offsetHeight;
      for (var i = 0; i < 6; i++) {
        document.getElementById('otp' + i).style.borderColor = '#ef4444';
        (function (idx) {
          setTimeout(function () { document.getElementById('otp' + idx).style.borderColor = ''; }, 1500);
        })(i);
      }
      return;
    }
    clearInterval(timerInterval);
    verifyBtn.textContent = 'جاري الحفظ...';
    try {
      var { data, error } = await supabase.from('partners').insert([{
        org_name: pendingPartner.org, email: pendingPartner.email, phone: pendingPartner.phone,
        org_type: pendingPartner.orgtype, city: pendingPartner.city, status: 'pending',
        fname: pendingPartner.fname, lname: pendingPartner.lname, title: pendingPartner.title,
        website: pendingPartner.website, plan: pendingPartner.plan, purpose: pendingPartner.purpose,
        volume: pendingPartner.volume, notes: pendingPartner.notes, ref_num: pendingPartner.refNum,
      }]).select().single();
      if (error) throw error;
      localStorage.setItem('rafd_partner_session', JSON.stringify({ id: data.id, email: data.email, org: data.org_name }));
      document.getElementById('refNum').textContent = pendingPartner.refNum;
      document.getElementById('otpSection').style.display = 'none';
      document.getElementById('successSection').style.display = 'block';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      console.error('Supabase insert error:', err);
      try {
        var { data: d2, error: e2 } = await supabase.from('partners').insert([{
          org_name: pendingPartner.org, email: pendingPartner.email, phone: pendingPartner.phone,
          org_type: pendingPartner.orgtype, city: pendingPartner.city, status: 'pending',
        }]).select().single();
        if (e2) throw e2;
        localStorage.setItem('rafd_partner_session', JSON.stringify({ id: d2.id, email: d2.email, org: d2.org_name }));
        document.getElementById('refNum').textContent = pendingPartner.refNum;
        document.getElementById('otpSection').style.display = 'none';
        document.getElementById('successSection').style.display = 'block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (err2) {
        alert('حدث خطأ أثناء حفظ البيانات: ' + err2.message);
        verifyBtn.disabled = false;
        verifyBtn.textContent = 'تحقق وفعّل الحساب ✓';
      }
    }
  }

  function showOTPError(msg) {
    var el = document.getElementById('otpError');
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(function () { el.style.display = 'none'; }, 4000);
  }

  async function resendOTP() {
    var btn = document.getElementById('resendBtn');
    btn.disabled = true;
    btn.textContent = 'جاري الإرسال...';
    try {
      var { error } = await supabase.auth.signInWithOtp({ email: pendingPartner.email, options: { shouldCreateUser: false } });
      if (error) throw error;
    } catch (e) {
      console.error('Supabase resend OTP error:', e);
      alert('حدث خطأ أثناء إعادة إرسال الرمز: ' + (e.message || ''));
    }
    btn.textContent = 'إعادة الإرسال';
    startTimer(600);
    for (var i = 0; i < 6; i++) {
      var d = document.getElementById('otp' + i);
      d.value = ''; d.classList.remove('filled'); d.style.borderColor = '';
    }
    document.getElementById('otp0').focus();
  }

  var submitBtn = document.getElementById('submitBtn');
  if (submitBtn) submitBtn.addEventListener('click', submitForm);
  var verifyBtn = document.getElementById('verifyBtn');
  if (verifyBtn) verifyBtn.addEventListener('click', verifyOTP);
  var resendBtn = document.getElementById('resendBtn');
  if (resendBtn) resendBtn.addEventListener('click', resendOTP);
})();
