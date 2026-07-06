'use strict';
(function () {
  var SUPABASE_URL = 'https://ycnnawohrbbluawxzttt.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_RgOring3FCEiBMGYPcPmZg_s_85Yc_f';
  var supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  // ===== AUTH CHECK =====
  var session = JSON.parse(localStorage.getItem('rafd_partner_session') || 'null');
  if (!session) { window.location.href = '/partner-login.html'; }
  supabase.auth.getSession().then(function (res) {
    if (!res.data.session) {
      localStorage.removeItem('rafd_partner_session');
      localStorage.removeItem('rafd_partner_requests');
      window.location.href = '/partner-login.html';
    }
  });

  var partner = null;

  async function loadPartnerData() {
    try {
      var res = await supabase.from('partners').select('*').eq('id', session.id).single();
      if (res.error || !res.data) {
        var res2 = await supabase.from('partners').select('*').eq('email', session.email).single();
        if (res2.error || !res2.data) { window.location.href = '/partner-login.html'; return; }
        partner = normalizePartner(res2.data);
      } else {
        partner = normalizePartner(res.data);
      }
      initUI();
    } catch (e) {
      console.error('Load partner error:', e);
      window.location.href = '/partner-login.html';
    }
  }

  function normalizePartner(p) {
    return {
      id: p.id,
      org: p.org_name || p.org || '',
      orgtype: p.org_type || p.orgtype || '',
      city: p.city || '',
      website: p.website || '',
      fname: p.fname || '',
      lname: p.lname || '',
      title: p.title || '',
      phone: p.phone || '',
      email: p.email || '',
      password: p.password || '',
      plan: p.plan || 'trial',
      status: p.status || 'pending',
      purpose: p.purpose || '',
      volume: p.volume || '',
      notes: p.notes || '',
      date: p.created_at ? new Date(p.created_at).toLocaleDateString('ar-SA') : '',
      refNum: p.ref_num || '',
      totalRequests: p.total_requests || 0,
      approvedRequests: p.approved_requests || 0,
      rejectedRequests: p.rejected_requests || 0,
      _raw: p,
    };
  }

  function initUI() {
    document.getElementById('sb_orgname').textContent = partner.org;
    document.getElementById('sb_orgtype').textContent = partner.orgtype;
    var planLabels = {trial:'تجريبية', basic:'أساسية', pro:'متقدمة'};
    document.getElementById('sb_plan').textContent = planLabels[partner.plan] || partner.plan;
    document.getElementById('sb_av').textContent = (partner.fname || '?')[0];
    document.getElementById('sb_uname').textContent = partner.fname + ' ' + partner.lname;
    document.getElementById('sb_urole').textContent = partner.title;
    document.getElementById('welcome_name').textContent = partner.fname;
    document.getElementById('welcome_sub').textContent = 'لوحة التحكم — ' + partner.org;

    if (partner.status === 'approved') {
      document.getElementById('status_alert').innerHTML = '<div class="alert alert-success">✅ حسابك نشط ومفعّل. يمكنك البدء في إضافة الطلبات.</div>';
    }

    renderStats();
    renderRecentRequests();
    renderSettings();
    renderSubscription();
  }

  function getMyRequests() {
    var all = JSON.parse(localStorage.getItem('rafd_partner_requests') || '[]');
    return all.filter(function (r) { return r.partnerId === partner.id; });
  }

  function saveRequest(req) {
    var all = JSON.parse(localStorage.getItem('rafd_partner_requests') || '[]');
    all.unshift(req);
    localStorage.setItem('rafd_partner_requests', JSON.stringify(all));
  }

  function renderStats() {
    var reqs = getMyRequests();
    var approved = reqs.filter(function (r) { return r.result === 'approved'; }).length;
    var rejected = reqs.filter(function (r) { return r.result === 'rejected'; }).length;
    var pending = reqs.filter(function (r) { return r.result === 'pending'; }).length;
    document.getElementById('stat_total').textContent = reqs.length;
    document.getElementById('stat_approved').textContent = approved;
    document.getElementById('stat_rejected').textContent = rejected;
    document.getElementById('stat_pending_req').textContent = pending;
    document.getElementById('stat_approved_pct').textContent = reqs.length ? Math.round(approved/reqs.length*100) + '% قبول' : '—';
    document.getElementById('stat_rejected_pct').textContent = reqs.length ? Math.round(rejected/reqs.length*100) + '% رفض' : '—';

    var limits = {trial:50, basic:500, pro:999999};
    var limit = limits[partner.plan] || 50;
    var pct = Math.min(100, Math.round(reqs.length / limit * 100));
    document.getElementById('usage_text').textContent = reqs.length + ' / ' + (limit === 999999 ? 'غير محدود' : limit);
    document.getElementById('usage_bar').style.width = pct + '%';
    document.getElementById('usage_note').textContent = limit === 999999 ? 'باقة متقدمة — طلبات غير محدودة' : (limit - reqs.length) + ' طلب متبقٍ هذا الشهر';
  }

  function renderRecentRequests() {
    var reqs = getMyRequests().slice(0, 5);
    var tbody = document.getElementById('recent_requests_table');
    if (!reqs.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#475569;padding:1.5rem">لا توجد طلبات بعد — <button id="addFirstReqBtn" style="background:none;border:none;color:#38bdf8;cursor:pointer;font-family:\'Almarai\',sans-serif;font-size:.83rem">أضف أول طلب</button></td></tr>';
      var addFirstBtn = document.getElementById('addFirstReqBtn');
      if (addFirstBtn) addFirstBtn.addEventListener('click', function () { showPage('new-request', null); });
      return;
    }
    tbody.innerHTML = reqs.map(function (r, i) {
      return '<tr data-req-id="' + r.id + '" style="cursor:pointer">' +
        '<td style="color:#475569">' + (i+1) + '</td>' +
        '<td style="font-weight:700;color:#e2e8f0">' + escapeHtml(r.name) + '</td>' +
        '<td style="color:#64748b">' + escapeHtml(r.purpose) + '</td>' +
        '<td style="color:#64748b;font-size:.78rem">' + escapeHtml(r.date) + '</td>' +
        '<td>' + resultBadge(r.result, r.score) + '</td>' +
      '</tr>';
    }).join('');
  }

  function renderAllRequests(list) {
    var reqs = list || getMyRequests();
    var tbody = document.getElementById('all_requests_table');
    if (!reqs.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#475569;padding:2rem">لا توجد طلبات</td></tr>';
      return;
    }
    tbody.innerHTML = reqs.map(function (r, i) {
      return '<tr data-req-id="' + r.id + '" style="cursor:pointer">' +
        '<td style="color:#475569">' + (i+1) + '</td>' +
        '<td style="font-weight:700;color:#e2e8f0">' + escapeHtml(r.name) + '</td>' +
        '<td style="color:#64748b;font-size:.78rem">' + escapeHtml(r.nationalId || '—') + '</td>' +
        '<td style="color:#64748b">' + escapeHtml(r.purpose) + '</td>' +
        '<td><span style="font-weight:800;color:' + (r.score >= 80 ? '#10b981' : r.score >= 60 ? '#f59e0b' : '#ef4444') + '">' + (r.score || '—') + '</span></td>' +
        '<td style="color:#64748b;font-size:.78rem">' + escapeHtml(r.date) + '</td>' +
        '<td>' + resultBadge(r.result, r.score) + '</td>' +
        '<td><button class="btn-sm danger" data-action="delete" data-req-id="' + r.id + '">حذف</button></td>' +
      '</tr>';
    }).join('');
  }

  function filterRequests() {
    var q = document.getElementById('req_search').value.toLowerCase();
    var status = document.getElementById('req_filter_status').value;
    var reqs = getMyRequests();
    if (q) reqs = reqs.filter(function (r) { return r.name.toLowerCase().includes(q) || (r.nationalId||'').includes(q); });
    if (status) reqs = reqs.filter(function (r) { return r.result === status; });
    renderAllRequests(reqs);
  }

  function resultBadge(result, score) {
    if (result === 'approved') return '<span class="badge b-active">✓ مقبول</span>';
    if (result === 'rejected') return '<span class="badge b-rejected">✕ مرفوض</span>';
    return '<span class="badge b-pending">⏳ قيد المراجعة</span>';
  }

  function submitRequest() {
    var name = document.getElementById('nf_name').value.trim();
    var purpose = document.getElementById('nf_purpose').value;
    if (!name || !purpose) { alert('يرجى إدخال الاسم وغرض الطلب'); return; }
    var score = parseInt(document.getElementById('nf_score').value) || null;
    var result = score !== null ? (score >= 70 ? 'approved' : 'rejected') : 'pending';

    var req = {
      id: Date.now(),
      partnerId: partner.id,
      name: name,
      nationalId: document.getElementById('nf_id').value.trim(),
      email: document.getElementById('nf_email').value.trim(),
      phone: document.getElementById('nf_phone').value.trim(),
      purpose: purpose,
      score: score,
      notes: document.getElementById('nf_notes').value.trim(),
      result: result,
      date: new Date().toLocaleDateString('ar-SA'),
      dateISO: new Date().toISOString(),
    };
    saveRequest(req);

    partner.totalRequests = (partner.totalRequests || 0) + 1;
    if (result === 'approved') partner.approvedRequests = (partner.approvedRequests || 0) + 1;
    if (result === 'rejected') partner.rejectedRequests = (partner.rejectedRequests || 0) + 1;
    updatePartnerInStorage();

    clearRequestForm();
    renderStats();
    renderRecentRequests();
    showPage('requests', null);
    renderAllRequests();
    alert('✅ تم حفظ الطلب بنجاح!\nالنتيجة: ' + (result === 'approved' ? 'مقبول' : result === 'rejected' ? 'مرفوض' : 'قيد المراجعة'));
  }

  function clearRequestForm() {
    ['nf_name','nf_id','nf_email','nf_phone','nf_score','nf_notes'].forEach(function (id) { document.getElementById(id).value = ''; });
    document.getElementById('nf_purpose').value = '';
  }

  function deleteRequest(id) {
    if (!confirm('هل تريد حذف هذا الطلب؟')) return;
    var all = JSON.parse(localStorage.getItem('rafd_partner_requests') || '[]');
    all = all.filter(function (r) { return r.id !== id; });
    localStorage.setItem('rafd_partner_requests', JSON.stringify(all));
    renderStats();
    renderRecentRequests();
    renderAllRequests();
  }

  function openReqModal(id) {
    var all = JSON.parse(localStorage.getItem('rafd_partner_requests') || '[]');
    var r = all.find(function (x) { return x.id === id; });
    if (!r) return;
    var scoreColor = r.score >= 80 ? '#10b981' : r.score >= 60 ? '#f59e0b' : '#ef4444';
    document.getElementById('reqModalBody').innerHTML =
      '<div style="display:grid;gap:.75rem">' +
      '<div style="display:flex;justify-content:space-between"><span style="color:#64748b">الاسم</span><span style="color:#e2e8f0;font-weight:700">' + escapeHtml(r.name) + '</span></div>' +
      '<div style="display:flex;justify-content:space-between"><span style="color:#64748b">رقم الهوية</span><span style="color:#e2e8f0">' + escapeHtml(r.nationalId || '—') + '</span></div>' +
      '<div style="display:flex;justify-content:space-between"><span style="color:#64748b">البريد</span><span style="color:#e2e8f0">' + escapeHtml(r.email || '—') + '</span></div>' +
      '<div style="display:flex;justify-content:space-between"><span style="color:#64748b">الجوال</span><span style="color:#e2e8f0">' + escapeHtml(r.phone || '—') + '</span></div>' +
      '<div style="display:flex;justify-content:space-between"><span style="color:#64748b">الغرض</span><span style="color:#e2e8f0">' + escapeHtml(r.purpose) + '</span></div>' +
      '<div style="display:flex;justify-content:space-between"><span style="color:#64748b">الدرجة</span><span style="color:' + scoreColor + ';font-weight:900;font-size:1.1rem">' + (r.score !== null ? r.score + '/100' : '—') + '</span></div>' +
      '<div style="display:flex;justify-content:space-between"><span style="color:#64748b">النتيجة</span>' + resultBadge(r.result, r.score) + '</div>' +
      '<div style="display:flex;justify-content:space-between"><span style="color:#64748b">التاريخ</span><span style="color:#e2e8f0">' + escapeHtml(r.date) + '</span></div>' +
      (r.notes ? '<div style="border-top:1px solid #334155;padding-top:.75rem"><div style="color:#64748b;font-size:.78rem;margin-bottom:.35rem">ملاحظات</div><div style="color:#94a3b8;font-size:.83rem;line-height:1.7">' + escapeHtml(r.notes) + '</div></div>' : '') +
      '</div>';
    document.getElementById('reqModal').classList.add('open');
  }

  function closeModal() { document.getElementById('reqModal').classList.remove('open'); }

  function renderSettings() {
    document.getElementById('set_orgname').value = partner.org || '';
    document.getElementById('set_orgtype').value = partner.orgtype || '';
    document.getElementById('set_city').value = partner.city || '';
    document.getElementById('set_website').value = partner.website || '';
    document.getElementById('set_fname').value = partner.fname || '';
    document.getElementById('set_lname').value = partner.lname || '';
    document.getElementById('set_title').value = partner.title || '';
    document.getElementById('set_phone').value = partner.phone || '';
    document.getElementById('set_email').value = partner.email || '';
  }

  async function saveSettings() {
    partner.org = document.getElementById('set_orgname').value.trim();
    partner.city = document.getElementById('set_city').value.trim();
    partner.website = document.getElementById('set_website').value.trim();
    partner.fname = document.getElementById('set_fname').value.trim();
    partner.lname = document.getElementById('set_lname').value.trim();
    partner.title = document.getElementById('set_title').value.trim();
    partner.phone = document.getElementById('set_phone').value.trim();
    await updatePartnerInStorage();
    initUI();
    alert('✅ تم حفظ التغييرات بنجاح!');
  }

  async function changePassword() {
    var p1 = document.getElementById('set_newpass').value;
    var p2 = document.getElementById('set_newpass2').value;
    if (p1.length < 8) { alert('كلمة المرور يجب أن تكون 8 أحرف على الأقل'); return; }
    if (p1 !== p2) { alert('كلمتا المرور غير متطابقتين'); return; }
    partner.password = btoa(p1);
    await updatePartnerInStorage();
    document.getElementById('set_newpass').value = '';
    document.getElementById('set_newpass2').value = '';
    alert('✅ تم تحديث كلمة المرور بنجاح!');
  }

  async function updatePartnerInStorage() {
    try {
      var { error } = await supabase.from('partners').update({
        org_name: partner.org,
        city: partner.city,
        website: partner.website,
        fname: partner.fname,
        lname: partner.lname,
        title: partner.title,
        phone: partner.phone,
        password: partner.password,
      }).eq('id', partner.id);
      if (error) console.error('Supabase update error:', error);
    } catch (e) {
      console.error('Update partner error:', e);
    }
  }

  function renderSubscription() {
    var planNames = {trial:'التجريبية 🎯', basic:'الأساسية ⚡', pro:'المتقدمة 🚀'};
    var prices = {trial:'مجاناً', basic:'499 ريال/شهر', pro:'999 ريال/شهر'};
    document.getElementById('current_plan_info').innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem">' +
      '<div>' +
      '<div style="font-size:1.2rem;font-weight:900;color:#fff">' + (planNames[partner.plan] || partner.plan) + '</div>' +
      '<div style="color:#38bdf8;font-size:1rem;font-weight:700;margin-top:.25rem">' + (prices[partner.plan] || '') + '</div>' +
      '<div style="color:#64748b;font-size:.78rem;margin-top:.25rem">تاريخ الاشتراك: ' + partner.date + '</div>' +
      '</div>' +
      '<span class="badge ' + (partner.plan === 'trial' ? 'b-trial' : partner.plan === 'basic' ? 'b-basic' : 'b-pro') + '">' + (planNames[partner.plan]) + '</span>' +
      '</div>';

    ['trial','basic','pro'].forEach(function (p) {
      var card = document.getElementById('plan_' + p);
      var btn = document.getElementById('btn_' + p);
      if (p === partner.plan) {
        card.classList.add('current');
        btn.textContent = '✓ باقتك الحالية';
        btn.disabled = true;
      } else {
        card.classList.remove('current');
        btn.disabled = false;
        btn.textContent = 'طلب الترقية';
      }
    });
  }

  function requestUpgrade(plan) {
    var planNames = {trial:'التجريبية', basic:'الأساسية', pro:'المتقدمة'};
    if (confirm('هل تريد طلب الترقية إلى الباقة ' + planNames[plan] + '؟\nسيتم إشعار فريق RAFD بطلبك.')) {
      var msgs = JSON.parse(localStorage.getItem('rafd_support_msgs') || '[]');
      msgs.unshift({id: Date.now(), partnerId: partner.id, org: partner.org, email: partner.email, subject: 'طلب ترقية باقة', msg: 'طلب ترقية من ' + partner.plan + ' إلى ' + plan, date: new Date().toLocaleDateString('ar-SA')});
      localStorage.setItem('rafd_support_msgs', JSON.stringify(msgs));
      alert('✅ تم إرسال طلب الترقية! سيتواصل معك فريقنا خلال 24 ساعة.');
    }
  }

  function sendSupport() {
    var msg = document.getElementById('sup_msg').value.trim();
    var subject = document.getElementById('sup_subject').value;
    if (!msg) { alert('يرجى كتابة نص الرسالة'); return; }
    var msgs = JSON.parse(localStorage.getItem('rafd_support_msgs') || '[]');
    msgs.unshift({id: Date.now(), partnerId: partner.id, org: partner.org, email: partner.email, subject: subject, msg: msg, date: new Date().toLocaleDateString('ar-SA')});
    localStorage.setItem('rafd_support_msgs', JSON.stringify(msgs));
    document.getElementById('sup_msg').value = '';
    alert('✅ تم إرسال رسالتك! سيرد عليك فريقنا خلال 24 ساعة عمل.');
  }

  function showPage(pageId, navEl) {
    document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
    document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.remove('active'); });
    var page = document.getElementById('page-' + pageId);
    if (page) page.classList.add('active');
    if (navEl) navEl.classList.add('active');
    if (pageId === 'requests') renderAllRequests();
    if (pageId === 'overview') { renderStats(); renderRecentRequests(); }
    if (pageId === 'subscription') renderSubscription();
    if (pageId === 'settings') renderSettings();
  }

  function requestApiAccess() {
    var org = localStorage.getItem('rafd_partner_org') ? JSON.parse(localStorage.getItem('rafd_partner_org')) : {};
    var name = (org.fname || '') + ' ' + (org.lname || '');
    var orgName = org.orgName || 'غير محدد';
    var email = org.email || 'غير محدد';
    var plan = org.plan || 'trial';
    if (plan !== 'pro') {
      alert('⚠️ طلب الوصول للـ API متاح فقط لباقة المتقدمة (999 ر.س). يرجى الترقية أولاً.');
      return;
    }
    var subject = encodeURIComponent('طلب وصول للـ API — ' + orgName);
    var body = encodeURIComponent('السلام عليكم،\n\nأرغب في طلب الوصول لواجهة برمجة RAFD API.\n\nاسم الجهة: ' + orgName + '\nالمسؤول: ' + name.trim() + '\nالبريد: ' + email + '\nالباقة: المتقدمة\n\nشكراً.');
    window.location.href = 'mailto:info@rafd-digital.com?subject=' + subject + '&body=' + body;
  }

  function logout() {
    localStorage.removeItem('rafd_partner_session');
    localStorage.removeItem('rafd_partner_requests');
    window.location.href = '/partner-login.html';
  }

  // ===== BINDINGS =====

  // Nav items
  document.querySelectorAll('.nav-item[data-page]').forEach(function (el) {
    el.addEventListener('click', function () { showPage(el.dataset.page, el); });
  });

  // Logout button
  var btnLogout = document.querySelector('.btn-logout');
  if (btnLogout) btnLogout.addEventListener('click', logout);

  // Overview "new request" button
  var overviewNewReqBtn = document.getElementById('overviewNewReqBtn');
  if (overviewNewReqBtn) overviewNewReqBtn.addEventListener('click', function () {
    showPage('new-request', document.querySelector('.nav-item[data-page="new-request"]'));
  });

  // Requests page "new request" button
  var requestsNewReqBtn = document.getElementById('requestsNewReqBtn');
  if (requestsNewReqBtn) requestsNewReqBtn.addEventListener('click', function () {
    showPage('new-request', null);
  });

  // Filter inputs
  var reqSearch = document.getElementById('req_search');
  if (reqSearch) reqSearch.addEventListener('input', filterRequests);
  var reqFilterStatus = document.getElementById('req_filter_status');
  if (reqFilterStatus) reqFilterStatus.addEventListener('change', filterRequests);

  // New request form buttons
  var submitRequestBtn = document.getElementById('submitRequestBtn');
  if (submitRequestBtn) submitRequestBtn.addEventListener('click', submitRequest);
  var clearRequestBtn = document.getElementById('clearRequestBtn');
  if (clearRequestBtn) clearRequestBtn.addEventListener('click', clearRequestForm);

  // Settings buttons
  var saveSettingsBtn = document.getElementById('saveSettingsBtn');
  if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', saveSettings);
  var changePasswordBtn = document.getElementById('changePasswordBtn');
  if (changePasswordBtn) changePasswordBtn.addEventListener('click', changePassword);
  var requestApiBtn = document.getElementById('requestApiBtn');
  if (requestApiBtn) requestApiBtn.addEventListener('click', requestApiAccess);

  // Subscription upgrade buttons
  ['trial','basic','pro'].forEach(function (plan) {
    var btn = document.getElementById('btn_' + plan);
    if (btn) btn.addEventListener('click', function () { requestUpgrade(plan); });
  });

  // Support send button
  var sendSupportBtn = document.getElementById('sendSupportBtn');
  if (sendSupportBtn) sendSupportBtn.addEventListener('click', sendSupport);

  // Modal close buttons
  document.querySelectorAll('.btn-close').forEach(function (btn) {
    btn.addEventListener('click', closeModal);
  });
  var modalGhostClose = document.querySelector('#reqModal .btn-ghost');
  if (modalGhostClose) modalGhostClose.addEventListener('click', closeModal);

  // Event delegation: recent requests table
  var recentTbody = document.getElementById('recent_requests_table');
  if (recentTbody) {
    recentTbody.addEventListener('click', function (e) {
      var row = e.target.closest('tr[data-req-id]');
      if (row) openReqModal(parseInt(row.dataset.reqId));
    });
  }

  // Event delegation: all requests table
  var allTbody = document.getElementById('all_requests_table');
  if (allTbody) {
    allTbody.addEventListener('click', function (e) {
      var deleteBtn = e.target.closest('[data-action="delete"]');
      if (deleteBtn) {
        e.stopPropagation();
        deleteRequest(parseInt(deleteBtn.dataset.reqId));
        return;
      }
      var row = e.target.closest('tr[data-req-id]');
      if (row) openReqModal(parseInt(row.dataset.reqId));
    });
  }

  // ===== START =====
  loadPartnerData();
})();
