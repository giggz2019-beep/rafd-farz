'use strict';
(function () {
  var SUPABASE_URL = 'https://ycnnawohrbbluawxzttt.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_RgOring3FCEiBMGYPcPmZg_s_85Yc_f';
  var supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  var supabasePartners = [];

  async function loadPartnersFromSupabase() {
    try {
      var res = await adminApi({ action: 'load' });
      if (!res.ok || !Array.isArray(res.data.partners)) return;
      supabasePartners = res.data.partners.map(function (p) {
        return {
          id: p.id,
          org: p.org_name,
          orgtype: p.org_type,
          city: p.city,
          website: p.website,
          fname: p.fname,
          lname: p.lname,
          title: p.title,
          email: p.email,
          phone: p.phone,
          plan: p.plan,
          status: p.status,
          date: p.created_at ? p.created_at.split('T')[0] : '',
          price: p.plan === 'pro' ? 999 : p.plan === 'basic' ? 499 : 0,
          purpose: p.purpose,
          notes: p.notes,
        };
      });
      renderPartnersTable(supabasePartners);
    } catch (e) { console.error('loadPartnersFromSupabase:', e); }
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function sanitizeCsvField(v) {
    var s = String(v == null ? '' : v);
    return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  }

  // ===== AUTH =====
  var _adminToken = null;

  async function adminApi(body) {
    var r = await fetch('/api/admin-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ supabase_token: _adminToken }, body)),
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  }

  function showAdminPanel(email) {
    document.getElementById('adminLogin').style.display = 'none';
    document.getElementById('adminWrap').classList.add('active');
    var el = document.getElementById('adminNameDisplay');
    if (el) el.textContent = email;
    renderAll();
    loadPartnersFromSupabase();
    startIdleWatch();
  }

  async function doLogin() {
    var email = document.getElementById('adminEmail').value.trim();
    var pass  = document.getElementById('adminPass').value;
    var errEl = document.getElementById('loginErr');
    var btn   = document.getElementById('loginBtn');

    errEl.style.display = 'none';
    if (!email || !pass) { errEl.textContent = 'يرجى إدخال البريد وكلمة المرور.'; errEl.style.display = 'block'; return; }

    btn.disabled = true;
    btn.textContent = 'جاري التحقق...';

    try {
      var { data: authData, error } = await supabase.auth.signInWithPassword({ email: email, password: pass });
      if (error) throw error;

      _adminToken = authData.session.access_token;
      var { ok } = await adminApi({ action: 'ping' });
      if (!ok) {
        _adminToken = null;
        await supabase.auth.signOut();
        throw new Error('غير مصرح');
      }

      showAdminPanel(email);
    } catch (e) {
      errEl.textContent = 'بيانات خاطئة أو غير مصرح لك بالدخول.';
      errEl.style.display = 'block';
      document.getElementById('adminPass').value = '';
    } finally {
      btn.disabled = false;
      btn.textContent = 'دخول للوحة التحكم';
    }
  }

  async function doLogout() {
    stopIdleWatch();
    _adminToken = null;
    await supabase.auth.signOut();
    document.getElementById('adminWrap').classList.remove('active');
    document.getElementById('adminLogin').style.display = 'flex';
  }

  // Auto-restore session on page load
  supabase.auth.getSession().then(async function (result) {
    var session = result.data.session;
    if (session) {
      _adminToken = session.access_token;
      var { ok } = await adminApi({ action: 'ping' });
      if (ok) {
        showAdminPanel(session.user.email);
      } else {
        _adminToken = null;
      }
    }
  });

  // ===== DATA =====
  var clients = JSON.parse(localStorage.getItem('rafd_clients') || '[]');

  if (clients.length === 0) {
    clients = [
      {id:1,fname:'أحمد',lname:'الزهراني',org:'شركة الأفق للتقنية',type:'شركة',email:'ahmed@ufuq.sa',phone:'0501234567',plan:'pro',status:'active',startDate:'2025-01-15',price:999,notes:'عميل مميز'},
      {id:2,fname:'سارة',lname:'القحطاني',org:'جامعة الملك عبدالله',type:'جامعة',email:'sara@kau.edu.sa',phone:'0509876543',plan:'basic',status:'active',startDate:'2025-02-01',price:499,notes:''},
      {id:3,fname:'محمد',lname:'العتيبي',org:'بنك الرياض',type:'بنك',email:'m.otaibi@riyadhbank.com',phone:'0551112233',plan:'pro',status:'active',startDate:'2025-01-20',price:999,notes:'يحتاج API مخصص'},
      {id:4,fname:'نورة',lname:'الشمري',org:'حاضنة وادي مكة',type:'حاضنة أعمال',email:'noura@wadi.sa',phone:'0562223344',plan:'basic',status:'active',startDate:'2025-03-10',price:499,notes:''},
      {id:5,fname:'خالد',lname:'البقمي',org:'مسرعة بادر',type:'مسرعة أعمال',email:'k.baqami@badir.sa',phone:'0573334455',plan:'trial',status:'active',startDate:'2025-06-10',price:0,notes:'في فترة التجربة'},
      {id:6,fname:'فاطمة',lname:'الدوسري',org:'شركة مدى للاستشارات',type:'شركة',email:'fatima@mada.sa',phone:'0584445566',plan:'basic',status:'expired',startDate:'2025-01-05',price:499,notes:'انتهى الاشتراك'},
      {id:7,fname:'عبدالله',lname:'الحربي',org:'جهة حكومية — وزارة الموارد',type:'جهة حكومية',email:'a.harbi@hrsd.gov.sa',phone:'0595556677',plan:'pro',status:'active',startDate:'2025-02-20',price:999,notes:'عقد سنوي'},
      {id:8,fname:'ريم',lname:'الغامدي',org:'شركة نمو للتقنية',type:'شركة',email:'reem@numuw.sa',phone:'0506667788',plan:'trial',status:'pending',startDate:'2025-06-15',price:0,notes:'بانتظار التفعيل'},
    ];
    saveClients();
  }

  function saveClients() {
    localStorage.setItem('rafd_clients', JSON.stringify(clients));
  }

  var filteredClients = clients.slice();
  var planFilter = '';
  var statusFilter = '';
  var searchQuery = '';

  // ===== RENDER =====
  function renderAll() {
    renderStats();
    renderTable();
    renderRevenue();
    renderTrials();
  }

  function renderStats() {
    var active = clients.filter(function (c) { return c.status === 'active'; }).length;
    var trials = clients.filter(function (c) { return c.plan === 'trial'; }).length;
    var pro = clients.filter(function (c) { return c.plan === 'pro'; }).length;
    var revenue = clients.filter(function (c) { return c.status === 'active'; }).reduce(function (s,c) { return s + c.price; }, 0);
    document.getElementById('statTotal').textContent = clients.length;
    document.getElementById('statActive').textContent = active + ' نشط';
    document.getElementById('statRevenue').textContent = revenue.toLocaleString();
    document.getElementById('statTrials').textContent = trials;
    document.getElementById('statPro').textContent = pro;
  }

  function renderTable() {
    applyFilters();
    var tbody = document.getElementById('clientsTable');
    document.getElementById('tableCount').textContent = filteredClients.length + ' عميل';
    if (filteredClients.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#475569;padding:2rem">لا توجد نتائج</td></tr>';
      return;
    }
    tbody.innerHTML = filteredClients.map(function (c, i) {
      var planBadge = c.plan === 'trial' ? '<span class="badge badge-trial">⏳ تجريبية</span>' :
                      c.plan === 'basic' ? '<span class="badge badge-basic">🔵 أساسية</span>' :
                      '<span class="badge badge-pro">🟣 متقدمة</span>';
      var statusBadge = c.status === 'active' ? '<span class="badge badge-active">✓ نشط</span>' :
                        c.status === 'expired' ? '<span class="badge badge-expired">✕ منتهي</span>' :
                        '<span class="badge badge-pending">⏸ معلّق</span>';
      var endDate = calcEndDate(c.startDate, c.plan);
      return '<tr data-client-id="' + c.id + '">' +
        '<td style="color:#475569">' + (i+1) + '</td>' +
        '<td><div class="client-info">' +
          '<div class="client-av">' + c.fname[0] + '</div>' +
          '<div><div class="client-name">' + c.fname + ' ' + c.lname + '</div><div class="client-org">' + c.org + '</div></div>' +
        '</div></td>' +
        '<td style="color:#64748b;font-size:.78rem">' + c.email + '</td>' +
        '<td>' + planBadge + '</td>' +
        '<td style="color:#64748b">' + formatDate(c.startDate) + '</td>' +
        '<td style="color:#64748b">' + endDate + '</td>' +
        '<td style="font-weight:700;color:' + (c.price>0?'#10b981':'#64748b') + '">' + (c.price > 0 ? c.price.toLocaleString() + ' ر' : 'مجاني') + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '<td><div class="actions-cell">' +
          '<button class="btn-sm" data-action="view" data-client-id="' + c.id + '">عرض</button>' +
          '<button class="btn-sm" data-action="edit" data-client-id="' + c.id + '">تعديل</button>' +
          '<button class="btn-sm danger" data-action="delete" data-client-id="' + c.id + '">حذف</button>' +
        '</div></td>' +
      '</tr>';
    }).join('');
  }

  function calcEndDate(start, plan) {
    var d = new Date(start);
    if (plan === 'trial') d.setDate(d.getDate() + 7);
    else d.setMonth(d.getMonth() + 1);
    return formatDate(d.toISOString().split('T')[0]);
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    var d = new Date(dateStr);
    return d.toLocaleDateString('ar-SA', {year:'numeric',month:'short',day:'numeric'});
  }

  function applyFilters() {
    filteredClients = clients.filter(function (c) {
      var matchSearch = !searchQuery ||
        (c.fname + ' ' + c.lname).includes(searchQuery) ||
        c.org.includes(searchQuery) ||
        c.email.includes(searchQuery);
      var matchPlan = !planFilter || c.plan === planFilter;
      var matchStatus = !statusFilter || c.status === statusFilter;
      return matchSearch && matchPlan && matchStatus;
    });
  }

  function filterClients(q) { searchQuery = q; renderTable(); }
  function filterByPlan(p) { planFilter = p; renderTable(); }
  function filterByStatus(s) { statusFilter = s; renderTable(); }

  // ===== DETAIL =====
  function openDetail(id) {
    var c = clients.find(function (x) { return x.id === id; });
    if (!c) return;
    document.getElementById('detailName').textContent = c.fname + ' ' + c.lname;
    var planLabel = c.plan === 'trial' ? 'التجريبية (7 أيام)' : c.plan === 'basic' ? 'الأساسية' : 'المتقدمة';
    var statusLabel = c.status === 'active' ? '✅ نشط' : c.status === 'expired' ? '❌ منتهي' : '⏸ معلّق';
    document.getElementById('detailBody').innerHTML =
      '<div class="detail-section">' +
        '<div class="detail-section-title">المعلومات الشخصية</div>' +
        '<div class="detail-row"><span class="detail-key">الاسم الكامل</span><span class="detail-val">' + c.fname + ' ' + c.lname + '</span></div>' +
        '<div class="detail-row"><span class="detail-key">البريد الإلكتروني</span><span class="detail-val">' + c.email + '</span></div>' +
        '<div class="detail-row"><span class="detail-key">رقم الجوال</span><span class="detail-val">' + (c.phone || '—') + '</span></div>' +
      '</div>' +
      '<div class="detail-section">' +
        '<div class="detail-section-title">معلومات الجهة</div>' +
        '<div class="detail-row"><span class="detail-key">اسم الجهة</span><span class="detail-val">' + c.org + '</span></div>' +
        '<div class="detail-row"><span class="detail-key">نوع الجهة</span><span class="detail-val">' + c.type + '</span></div>' +
      '</div>' +
      '<div class="detail-section">' +
        '<div class="detail-section-title">تفاصيل الاشتراك</div>' +
        '<div class="detail-row"><span class="detail-key">الباقة</span><span class="detail-val">' + planLabel + '</span></div>' +
        '<div class="detail-row"><span class="detail-key">السعر الشهري</span><span class="detail-val">' + (c.price > 0 ? c.price.toLocaleString() + ' ريال' : 'مجاني') + '</span></div>' +
        '<div class="detail-row"><span class="detail-key">تاريخ الاشتراك</span><span class="detail-val">' + formatDate(c.startDate) + '</span></div>' +
        '<div class="detail-row"><span class="detail-key">تاريخ الانتهاء</span><span class="detail-val">' + calcEndDate(c.startDate, c.plan) + '</span></div>' +
        '<div class="detail-row"><span class="detail-key">الحالة</span><span class="detail-val">' + statusLabel + '</span></div>' +
      '</div>' +
      (c.notes ? '<div class="detail-section"><div class="detail-section-title">ملاحظات</div><p style="color:#94a3b8;font-size:.85rem;line-height:1.6">' + c.notes + '</p></div>' : '') +
      '<div style="display:flex;gap:.75rem;margin-top:1rem">' +
        '<button class="btn-save" style="flex:1" id="detailUpgradeBtn">ترقية الباقة</button>' +
        '<button class="btn-cancel" style="flex:1" id="detailToggleBtn">تغيير الحالة</button>' +
      '</div>';
    document.getElementById('detailUpgradeBtn').addEventListener('click', function () { upgradeClient(id); });
    document.getElementById('detailToggleBtn').addEventListener('click', function () { toggleStatus(id); });
    document.getElementById('detailOverlay').classList.add('open');
  }

  function closeDetail() { document.getElementById('detailOverlay').classList.remove('open'); }

  function upgradeClient(id) {
    var c = clients.find(function (x) { return x.id === id; });
    if (!c) return;
    var plans = ['trial','basic','pro'];
    var idx = plans.indexOf(c.plan);
    if (idx < 2) {
      c.plan = plans[idx+1];
      c.price = c.plan === 'basic' ? 499 : 999;
      saveClients(); renderAll(); closeDetail();
      alert('تم ترقية الباقة بنجاح!');
    } else { alert('العميل على أعلى باقة متاحة.'); }
  }

  function toggleStatus(id) {
    var c = clients.find(function (x) { return x.id === id; });
    if (!c) return;
    var statuses = ['active','expired','pending'];
    var idx = statuses.indexOf(c.status);
    c.status = statuses[(idx+1) % 3];
    saveClients(); renderAll(); closeDetail();
  }

  function deleteClient(id) {
    if (!confirm('هل أنت متأكد من حذف هذا العميل؟')) return;
    clients = clients.filter(function (x) { return x.id !== id; });
    saveClients(); renderAll();
  }

  // ===== ADD CLIENT =====
  function openAddModal() {
    document.getElementById('f_date').value = new Date().toISOString().split('T')[0];
    document.getElementById('addModal').classList.add('open');
  }
  function closeAddModal() { document.getElementById('addModal').classList.remove('open'); }

  function saveClient() {
    var fname = document.getElementById('f_fname').value.trim();
    var lname = document.getElementById('f_lname').value.trim();
    var org = document.getElementById('f_org').value.trim();
    var email = document.getElementById('f_email').value.trim();
    if (!fname || !org || !email) { alert('يرجى ملء الحقول المطلوبة (الاسم، الجهة، البريد)'); return; }
    var plan = document.getElementById('f_plan').value;
    var price = plan === 'trial' ? 0 : plan === 'basic' ? 499 : 999;
    var newClient = {
      id: Date.now(),
      fname: fname, lname: lname,
      org: org,
      type: document.getElementById('f_type').value,
      email: email,
      phone: document.getElementById('f_phone').value.trim(),
      plan: plan, status: 'active',
      startDate: document.getElementById('f_date').value,
      price: price,
      notes: document.getElementById('f_notes').value.trim()
    };
    clients.unshift(newClient);
    saveClients(); renderAll(); closeAddModal();
    ['f_fname','f_lname','f_org','f_email','f_phone','f_notes'].forEach(function (id) { document.getElementById(id).value = ''; });
  }

  // ===== REVENUE PAGE =====
  function renderRevenue() {
    var activeClients = clients.filter(function (c) { return c.status === 'active'; });
    var monthly = activeClients.reduce(function (s,c) { return s + c.price; }, 0);
    var basicRev = activeClients.filter(function (c) { return c.plan === 'basic'; }).reduce(function (s,c) { return s + c.price; }, 0);
    var proRev = activeClients.filter(function (c) { return c.plan === 'pro'; }).reduce(function (s,c) { return s + c.price; }, 0);
    document.getElementById('revMonthly').textContent = monthly.toLocaleString();
    document.getElementById('revAnnual').textContent = (monthly * 12).toLocaleString();
    document.getElementById('revBasic').textContent = basicRev.toLocaleString();
    document.getElementById('revPro').textContent = proRev.toLocaleString();
    var chart = document.getElementById('revenueChart');
    var total = basicRev + proRev || 1;
    chart.innerHTML =
      '<div style="margin-bottom:1rem">' +
        '<div style="display:flex;justify-content:space-between;margin-bottom:.4rem"><span style="color:#60a5fa;font-size:.85rem">🔵 الأساسية</span><span style="color:#e2e8f0;font-weight:700">' + basicRev.toLocaleString() + ' ريال</span></div>' +
        '<div class="progress-bar"><div class="progress-fill" style="width:' + (basicRev/total*100).toFixed(0) + '%;background:linear-gradient(90deg,#3b82f6,#60a5fa)"></div></div>' +
      '</div>' +
      '<div>' +
        '<div style="display:flex;justify-content:space-between;margin-bottom:.4rem"><span style="color:#a78bfa;font-size:.85rem">🟣 المتقدمة</span><span style="color:#e2e8f0;font-weight:700">' + proRev.toLocaleString() + ' ريال</span></div>' +
        '<div class="progress-bar"><div class="progress-fill" style="width:' + (proRev/total*100).toFixed(0) + '%"></div></div>' +
      '</div>';
  }

  // ===== TRIALS PAGE =====
  function renderTrials() {
    var trialClients = clients.filter(function (c) { return c.plan === 'trial'; });
    var tbody = document.getElementById('trialsTable');
    if (!tbody) return;
    if (trialClients.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#475569;padding:2rem">لا توجد تجارب مجانية حالياً</td></tr>';
      return;
    }
    tbody.innerHTML = trialClients.map(function (c) {
      var start = new Date(c.startDate);
      var now = new Date();
      var daysUsed = Math.floor((now - start) / 86400000);
      var daysLeft = Math.max(0, 7 - daysUsed);
      var pct = Math.min(100, (daysUsed/7*100)).toFixed(0);
      return '<tr>' +
        '<td><div class="client-info"><div class="client-av">' + c.fname[0] + '</div><div><div class="client-name">' + c.fname + ' ' + c.lname + '</div><div class="client-org">' + c.org + '</div></div></div></td>' +
        '<td style="color:#64748b">' + formatDate(c.startDate) + '</td>' +
        '<td><span class="badge ' + (daysLeft <= 2 ? 'badge-expired' : 'badge-trial') + '">' + daysLeft + ' يوم</span></td>' +
        '<td style="min-width:120px"><div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%;background:linear-gradient(90deg,#f59e0b,#ef4444)"></div></div><div style="color:#64748b;font-size:.72rem;margin-top:.25rem">' + pct + '% مستخدم</div></td>' +
        '<td><button class="btn-sm" data-action="upgrade" data-client-id="' + c.id + '">ترقية</button></td>' +
      '</tr>';
    }).join('');
  }

  // ===== PARTNERS TABLE =====
  function renderPartnersTable(list) {
    var partners = list || JSON.parse(localStorage.getItem('rafd_partners') || '[]');
    var tbody = document.getElementById('partnersTable');
    var countEl = document.getElementById('partnersCount');
    var all = JSON.parse(localStorage.getItem('rafd_partners') || '[]');
    if (document.getElementById('ps_total')) document.getElementById('ps_total').textContent = all.length;
    if (document.getElementById('ps_pending')) document.getElementById('ps_pending').textContent = all.filter(function(p){return p.status==='pending';}).length;
    if (document.getElementById('ps_approved')) document.getElementById('ps_approved').textContent = all.filter(function(p){return p.status==='approved';}).length;
    if (document.getElementById('ps_rejected')) document.getElementById('ps_rejected').textContent = all.filter(function(p){return p.status==='rejected';}).length;
    if (countEl) countEl.textContent = partners.length;
    if (!tbody) return;
    if (partners.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#475569;padding:2rem">لا يوجد شركاء مسجّلون بعد — <a href="/register-partner.html" target="_blank" style="color:#38bdf8">افتح رابط التسجيل</a></td></tr>';
      return;
    }
    var planLabels = {trial:'تجريبية', basic:'أساسية', pro:'متقدمة'};
    var planBadge = {trial:'badge-trial', basic:'badge-basic', pro:'badge-pro'};
    tbody.innerHTML = partners.map(function (p, i) {
      var statusBadge = p.status === 'approved' ? '<span class="badge badge-active">✓ مقبول</span>' :
                        p.status === 'rejected' ? '<span class="badge badge-expired">✕ مرفوض</span>' :
                        '<span class="badge badge-pending">⏳ قيد المراجعة</span>';
      var reqCount = getPartnerRequestCount(p.id);
      var org = escapeHtml(p.org || '—');
      var city = escapeHtml(p.city || '');
      var orgtype = escapeHtml(p.orgtype || '—');
      var fullName = escapeHtml((p.fname||'') + ' ' + (p.lname||''));
      var title = escapeHtml(p.title || '');
      var email = escapeHtml(p.email || '—');
      var date = escapeHtml(p.date || '—');
      var initial = escapeHtml((p.org||'?')[0]);
      return '<tr data-partner-id="' + p.id + '" style="cursor:pointer">' +
        '<td style="color:#475569">' + (i+1) + '</td>' +
        '<td><div class="client-info"><div class="client-av">' + initial + '</div><div><div class="client-name">' + org + '</div><div class="client-org">' + city + '</div></div></div></td>' +
        '<td><span class="badge badge-pending" style="font-size:.7rem">' + orgtype + '</span></td>' +
        '<td><div class="client-name">' + fullName + '</div><div class="client-org">' + title + '</div></td>' +
        '<td style="color:#64748b;font-size:.78rem">' + email + '</td>' +
        '<td><span class="badge ' + (planBadge[p.plan]||'badge-basic') + '">' + (planLabels[p.plan]||escapeHtml(p.plan)) + '</span></td>' +
        '<td style="color:#64748b;font-size:.78rem">' + date + '</td>' +
        '<td style="text-align:center;font-weight:700;color:#e2e8f0">' + reqCount + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '<td><div class="actions-cell">' +
          (p.status !== 'approved' ? '<button class="btn-sm" data-action="approve" data-partner-id="' + p.id + '">قبول</button>' : '') +
          (p.status !== 'rejected' ? '<button class="btn-sm danger" data-action="reject" data-partner-id="' + p.id + '">رفض</button>' : '') +
          '<button class="btn-sm" data-action="delete-partner" data-partner-id="' + p.id + '">حذف</button>' +
        '</div></td>' +
      '</tr>';
    }).join('');
  }

  function getPartnerRequestCount(partnerId) {
    var all = JSON.parse(localStorage.getItem('rafd_partner_requests') || '[]');
    return all.filter(function (r) { return r.partnerId === partnerId; }).length;
  }

  function filterPartners() {
    var q = (document.getElementById('partner_search').value || '').toLowerCase();
    var status = document.getElementById('partner_filter').value;
    var partners = JSON.parse(localStorage.getItem('rafd_partners') || '[]');
    if (q) partners = partners.filter(function (p) { return (p.org||'').toLowerCase().includes(q) || (p.email||'').toLowerCase().includes(q) || (p.fname||'').toLowerCase().includes(q); });
    if (status) partners = partners.filter(function (p) { return p.status === status; });
    renderPartnersTable(partners);
  }

  async function approvePartner(id) {
    var p = supabasePartners.find(function (x) { return x.id === id; });
    if (p) {
      try {
        var { ok } = await adminApi({ action: 'update_status', data: { id: id, status: 'approved' } });
        if (!ok) throw new Error('فشل الطلب');
        p.status = 'approved';
        renderPartnersTable(supabasePartners);
        alert('✅ تم قبول الشريك: ' + p.org + '\nيمكنه الآن الدخول للوحة التحكم.');
      } catch (e) { alert('خطأ: ' + e.message); }
    }
  }

  async function rejectPartner(id) {
    var p = supabasePartners.find(function (x) { return x.id === id; });
    if (p) {
      if (!confirm('هل تريد رفض طلب: ' + p.org + '؟')) return;
      try {
        var { ok } = await adminApi({ action: 'update_status', data: { id: id, status: 'rejected' } });
        if (!ok) throw new Error('فشل الطلب');
        p.status = 'rejected';
        renderPartnersTable(supabasePartners);
      } catch (e) { alert('خطأ: ' + e.message); }
    }
  }

  async function deletePartner(id) {
    if (!confirm('هل تريد حذف هذا الشريك نهائياً؟')) return;
    try {
      var { ok } = await adminApi({ action: 'delete_partner', data: { id: id } });
      if (!ok) throw new Error('فشل الطلب');
      supabasePartners = supabasePartners.filter(function (x) { return x.id !== id; });
      renderPartnersTable(supabasePartners);
    } catch (e) { alert('خطأ: ' + e.message); }
  }

  function openPartnerDetail(id) {
    var p = supabasePartners.find(function (x) { return x.id === id; });
    if (!p) return;
    var reqs = JSON.parse(localStorage.getItem('rafd_partner_requests') || '[]').filter(function (r) { return r.partnerId === id; });
    var approved = reqs.filter(function (r) { return r.result === 'approved'; }).length;
    var rejected = reqs.filter(function (r) { return r.result === 'rejected'; }).length;
    var planLabels = {trial:'تجريبية', basic:'أساسية', pro:'متقدمة'};
    var safeWebsite = p.website ? escapeHtml(p.website) : '';
    document.getElementById('detailBody').innerHTML =
      '<div class="detail-section">' +
        '<div class="detail-section-title">معلومات الجهة</div>' +
        '<div class="detail-row"><span class="detail-key">اسم الجهة</span><span class="detail-val">' + escapeHtml(p.org) + '</span></div>' +
        '<div class="detail-row"><span class="detail-key">نوع الجهة</span><span class="detail-val">' + escapeHtml(p.orgtype) + '</span></div>' +
        '<div class="detail-row"><span class="detail-key">المدينة</span><span class="detail-val">' + escapeHtml(p.city||'—') + '</span></div>' +
        '<div class="detail-row"><span class="detail-key">الموقع</span><span class="detail-val">' + (safeWebsite ? '<a href="' + safeWebsite + '" target="_blank" rel="noopener noreferrer" style="color:#38bdf8">' + safeWebsite + '</a>' : '—') + '</span></div>' +
      '</div>' +
      '<div class="detail-section">' +
        '<div class="detail-section-title">المسؤول</div>' +
        '<div class="detail-row"><span class="detail-key">الاسم</span><span class="detail-val">' + escapeHtml(p.fname) + ' ' + escapeHtml(p.lname) + '</span></div>' +
        '<div class="detail-row"><span class="detail-key">المسمى</span><span class="detail-val">' + escapeHtml(p.title||'—') + '</span></div>' +
        '<div class="detail-row"><span class="detail-key">البريد</span><span class="detail-val">' + escapeHtml(p.email) + '</span></div>' +
        '<div class="detail-row"><span class="detail-key">الجوال</span><span class="detail-val">' + escapeHtml(p.phone||'—') + '</span></div>' +
      '</div>' +
      '<div class="detail-section">' +
        '<div class="detail-section-title">الاشتراك والإحصائيات</div>' +
        '<div class="detail-row"><span class="detail-key">الباقة</span><span class="detail-val">' + escapeHtml(planLabels[p.plan]||p.plan) + '</span></div>' +
        '<div class="detail-row"><span class="detail-key">السعر</span><span class="detail-val">' + (p.price > 0 ? p.price.toLocaleString()+' ريال/شهر' : 'مجاني') + '</span></div>' +
        '<div class="detail-row"><span class="detail-key">تاريخ التسجيل</span><span class="detail-val">' + escapeHtml(p.date) + '</span></div>' +
        '<div class="detail-row"><span class="detail-key">إجمالي الطلبات</span><span class="detail-val">' + reqs.length + '</span></div>' +
        '<div class="detail-row"><span class="detail-key">مقبول / مرفوض</span><span class="detail-val">' + approved + ' / ' + rejected + '</span></div>' +
        '<div class="detail-row"><span class="detail-key">الغرض</span><span class="detail-val">' + escapeHtml(p.purpose||'—') + '</span></div>' +
      '</div>' +
      '<div style="display:flex;gap:.75rem;margin-top:1rem">' +
        (p.status !== 'approved' ? '<button class="btn-save" style="flex:1" id="pdApproveBtn">✓ قبول الطلب</button>' : '<button class="btn-save" style="flex:1;opacity:.5" disabled>✓ مقبول</button>') +
        (p.status !== 'rejected' ? '<button class="btn-cancel" style="flex:1" id="pdRejectBtn">✕ رفض الطلب</button>' : '') +
      '</div>';
    var pdApproveBtn = document.getElementById('pdApproveBtn');
    if (pdApproveBtn) pdApproveBtn.addEventListener('click', async function () { await approvePartner(p.id); closeDetail(); });
    var pdRejectBtn = document.getElementById('pdRejectBtn');
    if (pdRejectBtn) pdRejectBtn.addEventListener('click', async function () { await rejectPartner(p.id); closeDetail(); });
    document.getElementById('detailOverlay').classList.add('open');
  }

  // ===== REPORTS =====
  function renderReports() {
    var active = clients.filter(function (c) { return c.status === 'active'; });
    var paid = active.filter(function (c) { return c.price > 0; });
    var totalRev = active.reduce(function (s,c) { return s + c.price; }, 0);
    var trials = clients.filter(function (c) { return c.plan === 'trial'; }).length;
    var total = clients.length;
    var conversion = total > 0 ? ((paid.length / total) * 100).toFixed(0) : 0;
    var arpu = paid.length > 0 ? Math.round(totalRev / paid.length) : 0;
    var expired = clients.filter(function (c) { return c.status === 'expired'; }).length;
    var churn = total > 0 ? ((expired / total) * 100).toFixed(0) : 0;
    var partners = JSON.parse(localStorage.getItem('rafd_partners') || '[]');
    var approvedPartners = partners.filter(function (p) { return p.status === 'approved'; });
    var partnerRev = approvedPartners.reduce(function (s,p) { return s + (p.price || 0); }, 0);
    if (document.getElementById('kpi_total_rev')) document.getElementById('kpi_total_rev').textContent = totalRev.toLocaleString();
    if (document.getElementById('kpi_conversion')) document.getElementById('kpi_conversion').textContent = conversion + '%';
    if (document.getElementById('kpi_arpu')) document.getElementById('kpi_arpu').textContent = arpu.toLocaleString();
    if (document.getElementById('kpi_partner_rev')) document.getElementById('kpi_partner_rev').textContent = partnerRev.toLocaleString();
    if (document.getElementById('kpi_churn')) document.getElementById('kpi_churn').textContent = churn + '%';
    var planChart = document.getElementById('chartPlans');
    if (planChart) {
      var trialC = clients.filter(function(c){return c.plan==='trial';}).length;
      var basicC = clients.filter(function(c){return c.plan==='basic';}).length;
      var proC = clients.filter(function(c){return c.plan==='pro';}).length;
      var max = Math.max(trialC, basicC, proC, 1);
      planChart.innerHTML = [
        {label:'⏳ تجريبية', count:trialC, color:'#f59e0b'},
        {label:'🔵 أساسية', count:basicC, color:'#60a5fa'},
        {label:'🟣 متقدمة', count:proC, color:'#a78bfa'}
      ].map(function (b) {
        return '<div style="margin-bottom:.85rem">' +
          '<div style="display:flex;justify-content:space-between;margin-bottom:.3rem"><span style="color:' + b.color + ';font-size:.83rem">' + b.label + '</span><span style="color:#e2e8f0;font-weight:700">' + b.count + '</span></div>' +
          '<div class="progress-bar"><div class="progress-fill" style="width:' + (b.count/max*100).toFixed(0) + '%;background:' + b.color + '"></div></div>' +
        '</div>';
      }).join('');
    }
    var typeChart = document.getElementById('chartTypes');
    if (typeChart) {
      var typeCounts = {};
      clients.forEach(function (c) { typeCounts[c.type] = (typeCounts[c.type]||0)+1; });
      var maxT = Math.max.apply(null, Object.values(typeCounts).concat([1]));
      typeChart.innerHTML = Object.entries(typeCounts).map(function (entry) {
        var t = entry[0], n = entry[1];
        return '<div style="margin-bottom:.85rem">' +
          '<div style="display:flex;justify-content:space-between;margin-bottom:.3rem"><span style="color:#94a3b8;font-size:.83rem">' + t + '</span><span style="color:#e2e8f0;font-weight:700">' + n + '</span></div>' +
          '<div class="progress-bar"><div class="progress-fill" style="width:' + (n/maxT*100).toFixed(0) + '%"></div></div>' +
        '</div>';
      }).join('');
    }
    var tbody = document.getElementById('reportTable');
    if (tbody) {
      document.getElementById('reportCount').textContent = clients.length;
      var planLabel = {trial:'تجريبية', basic:'أساسية', pro:'متقدمة'};
      tbody.innerHTML = clients.map(function (c) {
        return '<tr>' +
          '<td>' + c.fname + ' ' + c.lname + '</td>' +
          '<td style="color:#64748b">' + c.org + '</td>' +
          '<td>' + (planLabel[c.plan]||c.plan) + '</td>' +
          '<td style="color:' + (c.price>0?'#10b981':'#64748b') + '">' + (c.price>0?c.price.toLocaleString()+' ر':'مجاني') + '</td>' +
          '<td><span class="badge ' + (c.status==='active'?'badge-active':c.status==='expired'?'badge-expired':'badge-pending') + '">' + (c.status==='active'?'نشط':c.status==='expired'?'منتهي':'معلّق') + '</span></td>' +
          '<td style="color:#64748b">' + formatDate(c.startDate) + '</td>' +
        '</tr>';
      }).join('');
    }
  }

  function exportCSV() {
    var headers = ['الاسم','الجهة','البريد','الباقة','السعر','الحالة','تاريخ الاشتراك'];
    var rows = clients.map(function (c) {
      return [
        sanitizeCsvField(c.fname+' '+c.lname),
        sanitizeCsvField(c.org),
        sanitizeCsvField(c.email),
        sanitizeCsvField(c.plan),
        sanitizeCsvField(c.price),
        sanitizeCsvField(c.status),
        sanitizeCsvField(c.startDate)
      ];
    });
    var csv = [headers].concat(rows).map(function (r) { return r.map(function (v) { return '"'+String(v).replace(/"/g,'""')+'"'; }).join(','); }).join('\n');
    var blob = new Blob(['﻿'+csv], {type:'text/csv;charset=utf-8'});
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'rafd-clients-'+new Date().toISOString().split('T')[0]+'.csv';
    a.click();
  }

  // ===== SESSION TIMEOUT =====
  var _idleTimer = null;
  var IDLE_LIMIT_MS = 30 * 60 * 1000;
  var WARN_BEFORE_MS = 5 * 60 * 1000;

  function resetIdleTimer() {
    clearTimeout(_idleTimer);
    _idleTimer = setTimeout(function () {
      var stay = confirm('ستنتهي جلستك خلال 5 دقائق. هل تريد الاستمرار؟');
      if (stay) {
        resetIdleTimer();
      } else {
        doLogout();
      }
    }, IDLE_LIMIT_MS - WARN_BEFORE_MS);
  }

  function startIdleWatch() {
    ['mousemove','keydown','click','touchstart','scroll'].forEach(function (evt) {
      document.addEventListener(evt, resetIdleTimer, { passive: true });
    });
    resetIdleTimer();
  }

  function stopIdleWatch() {
    clearTimeout(_idleTimer);
    ['mousemove','keydown','click','touchstart','scroll'].forEach(function (evt) {
      document.removeEventListener(evt, resetIdleTimer);
    });
  }

  // ===== NAVIGATION =====
  function showPage(page, navEl) {
    ['clients','revenue','partners','trials','reports'].forEach(function (p) {
      var el = document.getElementById('page-' + p);
      if (el) el.style.display = p === page ? 'block' : 'none';
    });
    document.querySelectorAll('.nav-item').forEach(function (el) { el.classList.remove('active'); });
    if (navEl) navEl.classList.add('active');
    if (page === 'partners') renderPartnersTable();
    if (page === 'reports') renderReports();
  }

  // ===== BINDINGS =====

  // Login inputs
  var adminEmail = document.getElementById('adminEmail');
  if (adminEmail) adminEmail.addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
  var adminPass = document.getElementById('adminPass');
  if (adminPass) adminPass.addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
  var loginBtn = document.getElementById('loginBtn');
  if (loginBtn) loginBtn.addEventListener('click', doLogin);

  // Sidebar nav items
  document.querySelectorAll('.nav-item[data-page]').forEach(function (el) {
    el.addEventListener('click', function () { showPage(el.dataset.page, el); });
  });

  // Main site nav item
  var navMainSite = document.getElementById('navMainSite');
  if (navMainSite) navMainSite.addEventListener('click', function () { window.open('/', '_blank'); });

  // Logout span
  var adminLogoutSpan = document.getElementById('adminLogoutSpan');
  if (adminLogoutSpan) {
    adminLogoutSpan.addEventListener('click', doLogout);
    adminLogoutSpan.addEventListener('mouseover', function () { this.style.color = '#ef4444'; });
    adminLogoutSpan.addEventListener('mouseout', function () { this.style.color = '#64748b'; });
  }

  // Add client button
  var adminAddBtn = document.getElementById('adminAddBtn');
  if (adminAddBtn) adminAddBtn.addEventListener('click', openAddModal);

  // Filter inputs (clients)
  var clientSearch = document.getElementById('clientSearch');
  if (clientSearch) clientSearch.addEventListener('input', function () { filterClients(this.value); });
  var planFilterEl = document.getElementById('planFilter');
  if (planFilterEl) planFilterEl.addEventListener('change', function () { filterByPlan(this.value); });
  var statusFilterEl = document.getElementById('statusFilter');
  if (statusFilterEl) statusFilterEl.addEventListener('change', function () { filterByStatus(this.value); });

  // Filter inputs (partners)
  var partnerSearch = document.getElementById('partner_search');
  if (partnerSearch) partnerSearch.addEventListener('input', filterPartners);
  var partnerFilter = document.getElementById('partner_filter');
  if (partnerFilter) partnerFilter.addEventListener('change', filterPartners);

  // Export CSV button
  var exportCsvBtn = document.getElementById('exportCsvBtn');
  if (exportCsvBtn) exportCsvBtn.addEventListener('click', exportCSV);

  // Detail overlay close on backdrop click
  var detailOverlay = document.getElementById('detailOverlay');
  if (detailOverlay) {
    detailOverlay.addEventListener('click', function (e) { if (e.target === this) closeDetail(); });
  }
  var detailCloseBtn = document.getElementById('detailCloseBtn');
  if (detailCloseBtn) detailCloseBtn.addEventListener('click', closeDetail);

  // Add modal
  var addModal = document.getElementById('addModal');
  if (addModal) addModal.addEventListener('click', function (e) { if (e.target === this) closeAddModal(); });
  var addModalCloseBtn = document.getElementById('addModalCloseBtn');
  if (addModalCloseBtn) addModalCloseBtn.addEventListener('click', closeAddModal);
  var addModalCancelBtn = document.getElementById('addModalCancelBtn');
  if (addModalCancelBtn) addModalCancelBtn.addEventListener('click', closeAddModal);
  var addModalSaveBtn = document.getElementById('addModalSaveBtn');
  if (addModalSaveBtn) addModalSaveBtn.addEventListener('click', saveClient);

  // Event delegation: clients table
  var clientsTable = document.getElementById('clientsTable');
  if (clientsTable) {
    clientsTable.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (btn) {
        var clientId = parseInt(btn.dataset.clientId);
        var action = btn.dataset.action;
        if (action === 'view' || action === 'edit') openDetail(clientId);
        else if (action === 'delete') deleteClient(clientId);
        return;
      }
      var row = e.target.closest('tr[data-client-id]');
      if (row) openDetail(parseInt(row.dataset.clientId));
    });
  }

  // Event delegation: trials table
  var trialsTable = document.getElementById('trialsTable');
  if (trialsTable) {
    trialsTable.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action="upgrade"]');
      if (btn) upgradeClient(parseInt(btn.dataset.clientId));
    });
  }

  // Event delegation: partners table
  var partnersTable = document.getElementById('partnersTable');
  if (partnersTable) {
    partnersTable.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (btn) {
        var partnerId = parseInt(btn.dataset.partnerId);
        var action = btn.dataset.action;
        if (action === 'approve') approvePartner(partnerId);
        else if (action === 'reject') rejectPartner(partnerId);
        else if (action === 'delete-partner') deletePartner(partnerId);
        return;
      }
      var row = e.target.closest('tr[data-partner-id]');
      if (row) openPartnerDetail(parseInt(row.dataset.partnerId));
    });
  }
})();
