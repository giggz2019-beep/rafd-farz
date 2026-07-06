'use strict';
(function () {
  const SUPABASE_URL = 'https://ycnnawohrbbluawxzttt.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_RgOring3FCEiBMGYPcPmZg_s_85Yc_f';
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  function showErr(msg) {
    var errEl = document.getElementById('errMsg');
    errEl.textContent = msg;
    errEl.style.display = 'block';
  }

  async function doSignup() {
    var fname   = document.getElementById('fname').value.trim();
    var lname   = document.getElementById('lname').value.trim();
    var orgname = document.getElementById('orgname').value.trim();
    var orgtype = document.getElementById('orgtype').value;
    var email   = document.getElementById('email').value.trim();
    var pass    = document.getElementById('pass').value;
    var errEl   = document.getElementById('errMsg');
    var sucEl   = document.getElementById('successMsg');
    var btn     = document.getElementById('signupBtn');

    errEl.style.display = 'none';
    sucEl.style.display = 'none';

    if (!fname || !lname) { showErr('يرجى إدخال الاسم الأول واسم العائلة.'); return; }
    if (!orgname)         { showErr('يرجى إدخال اسم الجهة.'); return; }
    if (!orgtype)         { showErr('يرجى اختيار نوع الجهة.'); return; }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showErr('يرجى إدخال بريد إلكتروني صحيح.'); return; }
    if (pass.length < 8)  { showErr('كلمة المرور يجب أن تكون 8 أحرف على الأقل.'); return; }

    btn.disabled = true;
    btn.textContent = 'جاري إنشاء الحساب...';

    try {
      var { data: existing } = await supabase
        .from('partners')
        .select('email')
        .eq('email', email)
        .maybeSingle();

      if (existing) {
        showErr('هذا البريد الإلكتروني مسجّل مسبقاً. يرجى تسجيل الدخول.');
        return;
      }

      var { error: authErr } = await supabase.auth.signUp({ email, password: pass });
      if (authErr && authErr.message !== 'User already registered') throw authErr;

      var refNum = 'RAFD-' + new Date().getFullYear() + '-' + (Math.floor(Math.random() * 90000) + 10000);

      var { data, error } = await supabase
        .from('partners')
        .insert([{
          fname,
          lname,
          org_name: orgname,
          org_type: orgtype,
          email,
          status: 'approved',
          plan: 'trial',
          ref_num: refNum,
          phone: '',
          city: '',
          title: '',
        }])
        .select()
        .single();

      if (error) throw error;

      localStorage.setItem('rafd_session', JSON.stringify({
        id: data.id,
        email: data.email,
        org: data.org_name
      }));

      document.getElementById('formArea').style.display = 'none';
      sucEl.innerHTML = '✅ تم إنشاء حسابك بنجاح!<br>رقم الحساب: <strong>' + refNum + '</strong><br><br><a href="/dashboard.html" style="color:#059669;font-weight:700">الذهاب للوحة التحكم ←</a>';
      sucEl.style.display = 'block';

    } catch(err) {
      console.error('Signup error:', err);
      showErr('حدث خطأ أثناء إنشاء الحساب. يرجى المحاولة مرة أخرى.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'إنشاء الحساب والبدء';
    }
  }

  document.getElementById('signupBtn').addEventListener('click', doSignup);
})();
