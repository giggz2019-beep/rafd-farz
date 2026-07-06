'use strict';
(function () {
  var SUPABASE_URL = 'https://ycnnawohrbbluawxzttt.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_RgOring3FCEiBMGYPcPmZg_s_85Yc_f';
  var supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  (function () {
    var s = localStorage.getItem('rafd_session');
    if (!s) { window.location.href = '/login.html'; return; }
    supabase.auth.getSession().then(function (res) {
      if (!res.data.session) {
        localStorage.removeItem('rafd_session');
        window.location.href = '/login.html';
      }
    });
  })();

  function logout() {
    localStorage.removeItem('rafd_session');
    window.location.href = '/';
  }

  var pageTitles = {
    overview: 'نظرة عامة',
    applications: 'الطلبات',
    criteria: 'معايير التقييم',
    reports: 'التقارير',
    identity: 'التحقق من الهوية',
    billing: 'الاشتراك',
    settings: 'الإعدادات'
  };

  function showPage(name, el) {
    document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
    document.querySelectorAll('.sb-item').forEach(function (i) { i.classList.remove('active'); });
    document.getElementById('page-' + name).classList.add('active');
    if (el) el.classList.add('active');
    document.getElementById('pageTitle').textContent = pageTitles[name] || name;
  }

  // Sidebar nav items
  document.querySelectorAll('.sb-item[data-page]').forEach(function (el) {
    el.addEventListener('click', function () { showPage(el.dataset.page, el); });
  });

  // Logout
  var logoutLink = document.getElementById('logoutLink');
  if (logoutLink) logoutLink.addEventListener('click', function (e) { e.preventDefault(); logout(); });

  // "New Request" buttons
  document.querySelectorAll('[data-goto-applications]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.preventDefault();
      showPage('applications', null);
    });
  });
})();
