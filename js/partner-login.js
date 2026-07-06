'use strict';
(function () {
  // Logo error fallback (replaces inline onerror)
  var logoImg = document.querySelector('.logo-icon img');
  if (logoImg) {
    function onLogoError() {
      logoImg.parentElement.style.background = 'linear-gradient(135deg,#1a3a4a,#4a9d6f)';
      var span = document.createElement('span');
      span.style.cssText = 'font-size:1.5rem;font-weight:900;color:#fff';
      span.textContent = 'R';
      logoImg.parentElement.replaceChild(span, logoImg);
    }
    if (logoImg.complete && logoImg.naturalHeight === 0) onLogoError();
    else logoImg.addEventListener('error', onLogoError);
  }

  var SUPABASE_URL = 'https://ycnnawohrbbluawxzttt.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_RgOring3FCEiBMGYPcPmZg_s_85Yc_f';
  var supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  async function doLogin() {
    var email = document.getElementById('loginEmail').value.trim();
    var pass = document.getElementById('loginPass').value;
    var errEl = document.getElementById('errMsg');
    var pendingEl = document.getElementById('pendingMsg');
    var btn = document.getElementById('loginBtn');

    errEl.style.display = 'none';
    pendingEl.style.display = 'none';

    if (!email || !pass) {
      errEl.textContent = 'يرجى إدخال البريد الإلكتروني وكلمة المرور.';
      errEl.style.display = 'block';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'جاري التحقق...';

    try {
      var authOk = false;
      var { error: authErr } = await supabase.auth.signInWithPassword({ email, password: pass });

      if (!authErr) {
        authOk = true;
      } else {
        var { data: old } = await supabase.from('partners').select('password').eq('email', email).maybeSingle();
        if (old) {
          var btaoMatch = false;
          try { btaoMatch = (atob(old.password || '') === pass); } catch(e) {}
          if (btaoMatch) {
            await supabase.auth.signUp({ email, password: pass });
            var { error: retryErr } = await supabase.auth.signInWithPassword({ email, password: pass });
            if (!retryErr) authOk = true;
          }
        }
      }

      if (!authOk) {
        errEl.textContent = 'بيانات تسجيل الدخول غير صحيحة. يرجى التحقق من البريد الإلكتروني وكلمة المرور.';
        errEl.style.display = 'block';
        return;
      }

      var { data: partner } = await supabase.from('partners').select('id,email,org_name,status').eq('email', email).maybeSingle();

      if (!partner) {
        await supabase.auth.signOut();
        errEl.textContent = 'هذا البريد غير مسجّل في النظام.';
        errEl.style.display = 'block';
        return;
      }

      if (partner.status === 'pending') {
        await supabase.auth.signOut();
        errEl.textContent = 'طلبك لا يزال قيد المراجعة. سيتم التواصل معك عند الموافقة.';
        errEl.style.display = 'block';
        return;
      }

      if (partner.status === 'rejected') {
        await supabase.auth.signOut();
        errEl.textContent = 'عذراً، طلب تسجيلك تم رفضه. تواصل مع الدعم للمزيد.';
        errEl.style.display = 'block';
        return;
      }

      localStorage.setItem('rafd_partner_session', JSON.stringify({
        id: partner.id, email: partner.email, org: partner.org_name
      }));
      window.location.href = '/partner-dashboard.html';

    } catch(err) {
      console.error('Login error:', err);
      errEl.textContent = 'حدث خطأ أثناء تسجيل الدخول. يرجى المحاولة مرة أخرى.';
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = 'دخول للوحة التحكم';
    }
  }

  document.getElementById('loginBtn').addEventListener('click', doLogin);
  document.getElementById('loginEmail').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doLogin();
  });
  document.getElementById('loginPass').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doLogin();
  });
})();
