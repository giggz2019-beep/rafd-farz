'use strict';
(function () {
  // Logo error fallbacks
  var brandLogo = document.querySelector('.brand-logo');
  if (brandLogo) {
    if (brandLogo.complete && brandLogo.naturalHeight === 0) {
      brandLogo.style.display = 'none';
      if (brandLogo.nextElementSibling) brandLogo.nextElementSibling.style.display = 'flex';
    } else {
      brandLogo.addEventListener('error', function () {
        brandLogo.style.display = 'none';
        if (brandLogo.nextElementSibling) brandLogo.nextElementSibling.style.display = 'flex';
      });
    }
  }
  var footerBrandImg = document.querySelector('.footer-brand img');
  if (footerBrandImg) {
    if (footerBrandImg.complete && footerBrandImg.naturalHeight === 0) {
      footerBrandImg.style.display = 'none';
      if (footerBrandImg.nextElementSibling) footerBrandImg.nextElementSibling.style.display = 'flex';
    } else {
      footerBrandImg.addEventListener('error', function () {
        footerBrandImg.style.display = 'none';
        if (footerBrandImg.nextElementSibling) footerBrandImg.nextElementSibling.style.display = 'flex';
      });
    }
  }

  // Hamburger
  document.getElementById('hamburger').addEventListener('click', function () {
    var menu = document.getElementById('mobileMenu');
    var isOpen = menu.classList.toggle('open');
    this.setAttribute('aria-expanded', isOpen);
  });

  function closeMobileMenu() {
    document.getElementById('mobileMenu').classList.remove('open');
  }

  document.addEventListener('click', function (e) {
    var menu = document.getElementById('mobileMenu');
    var hamburger = document.getElementById('hamburger');
    if (menu.classList.contains('open') && !menu.contains(e.target) && !hamburger.contains(e.target)) {
      menu.classList.remove('open');
    }
  });

  // Mobile nav anchor links close the menu
  document.querySelectorAll('#mobileMenu a[href^="#"]').forEach(function (el) {
    el.addEventListener('click', closeMobileMenu);
  });

  // Language toggle
  var TRANSLATIONS = {
    ar: {
      'hero-title-line1': 'مرحباً بكم في',
      'hero-title-line2': 'مستقبل التقييم',
      'hero-title-line3': 'الذكي',
      'hero-desc': 'RAFD — منصة الذكاء الاصطناعي للتقييم الفوري. تُمكّن الشركات والبنوك والجامعات والحاضنات من أتمتة قرارات القبول والرفض بناءً على معاييرها الخاصة — بدون تحيّز.',
      'cta-primary': 'ابدأ تجربتك المجانية ←',
      'cta-demo': 'جرّب النظام الآن',
      'nav-features': 'المميزات',
      'nav-how': 'كيف نعمل',
      'nav-about': 'من نحن',
      'nav-pricing': 'الأسعار',
      'nav-partner': '🤝 انضم كشريك',
      'btn-partner-login': 'دخول الشركاء',
      'btn-login': 'دخول'
    },
    en: {
      'hero-title-line1': 'Welcome to',
      'hero-title-line2': 'the Future of',
      'hero-title-line3': 'Smart Screening',
      'hero-desc': 'RAFD — an AI-powered instant assessment platform. Enabling companies, banks, universities, and accelerators to automate accept/reject decisions based on their own criteria — bias-free.',
      'cta-primary': 'Start Free Trial ←',
      'cta-demo': 'Try It Now',
      'nav-features': 'Features',
      'nav-how': 'How It Works',
      'nav-about': 'About Us',
      'nav-pricing': 'Pricing',
      'nav-partner': '🤝 Become a Partner',
      'btn-partner-login': 'Partner Login',
      'btn-login': 'Login'
    }
  };

  function applyLang(lang) {
    var t = TRANSLATIONS[lang];
    var html = document.documentElement;
    if (lang === 'en') {
      html.setAttribute('lang', 'en');
      html.setAttribute('dir', 'ltr');
    } else {
      html.setAttribute('lang', 'ar');
      html.setAttribute('dir', 'rtl');
    }
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (t[key]) el.textContent = t[key];
    });
    var desktopBtn = document.getElementById('langToggleDesktop');
    var mobileLabel = document.getElementById('langLabelMobile');
    if (desktopBtn) desktopBtn.textContent = lang === 'ar' ? 'EN' : 'AR';
    if (mobileLabel) mobileLabel.textContent = lang === 'ar' ? 'English' : 'العربية';
    localStorage.setItem('rafd_lang', lang);
  }

  function toggleLang() {
    var current = localStorage.getItem('rafd_lang') || 'ar';
    applyLang(current === 'ar' ? 'en' : 'ar');
  }

  (function () {
    var saved = localStorage.getItem('rafd_lang');
    if (saved && saved !== 'ar') applyLang(saved);
  })();

  var langDesktop = document.getElementById('langToggleDesktop');
  if (langDesktop) langDesktop.addEventListener('click', toggleLang);
  var langMobile = document.getElementById('langToggleMobile');
  if (langMobile) langMobile.addEventListener('click', toggleLang);

  window.addEventListener('scroll', function () {
    var nb = document.getElementById('navbar');
    if (window.scrollY > 50) nb.style.boxShadow = '0 4px 24px rgba(0,0,0,.08)';
    else nb.style.boxShadow = 'none';
  });

  // Animated counters
  (function () {
    function animateCounter(el) {
      var target = el.getAttribute('data-count');
      var isPercent = target.includes('%');
      var isPlus = target.includes('+');
      var num = parseFloat(target.replace(/[^0-9.]/g, ''));
      var duration = 1800;
      var start = performance.now();
      function update(now) {
        var elapsed = now - start;
        var progress = Math.min(elapsed / duration, 1);
        var ease = 1 - Math.pow(1 - progress, 3);
        var current = Math.floor(ease * num);
        el.textContent = (isPlus ? '+' : '') + current + (isPercent ? '%' : '');
        if (progress < 1) requestAnimationFrame(update);
        else el.textContent = target;
      }
      requestAnimationFrame(update);
    }
    var counterObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          counterObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });
    document.querySelectorAll('[data-count]').forEach(function (el) {
      counterObserver.observe(el);
    });
  })();

  // ===== KHALID AI AGENT =====
  var khReplies = {
    'ما هي المنصة': 'RAFD هي منصة ذكاء اصطناعي متكاملة تُمكّن الجهات (بنوك، جامعات، شركات، حاضنات) من أتمتة قرارات القبول والرفض بناءً على معاييرها الخاصة — سواء كانت توظيفاً أو تمويلاً أو قبولاً جامعياً. النتيجة فورية وبدون تحيّز بشري. 🤖',
    'كيف اشترك': 'الاشتراك سهل جداً! 👇<br>1️⃣ اضغط على <a href="/signup.html" style="color:#10b981">"ابدأ مجاناً"</a><br>2️⃣ أدخل بيانات جهتك (الاسم، البريد، كلمة المرور)<br>3️⃣ اختر باقتك (تبدأ بـ 7 أيام تجريبية مجانية)<br>4️⃣ حدّد معاييرك وابدأ فوراً! ✅',
    'طريق الاشتراك': 'الاشتراك سهل جداً! 👇<br>1️⃣ اضغط على <a href="/signup.html" style="color:#10b981">"ابدأ مجاناً"</a><br>2️⃣ أدخل بيانات جهتك<br>3️⃣ اختر باقتك (تبدأ بـ 7 أيام تجريبية مجانية)<br>4️⃣ حدّد معاييرك وابدأ فوراً! ✅',
    'كيف أبدأ': 'الاشتراك سهل جداً! 👇<br>1️⃣ اضغط على <a href="/signup.html" style="color:#10b981">"ابدأ مجاناً"</a><br>2️⃣ أدخل بيانات جهتك<br>3️⃣ اختر باقتك<br>4️⃣ حدّد معاييرك وابدأ فوراً! ✅',
    'طريقة عملكم': 'طريقة عمل RAFD في 4 خطوات بسيطة 🔄<br><br>1️⃣ <b>حدّد معاييرك:</b> تُدخل جهتك معايير القبول والرفض عبر لوحة التحكم (بدون برمجة)<br>2️⃣ <b>استقبل الطلبات:</b> تُشارك رابط النموذج مع المتقدمين ليُقدّموا طلباتهم<br>3️⃣ <b>التحليل الذكي:</b> يحلّل الذكاء الاصطناعي كل طلب وفق معاييرك فورياً<br>4️⃣ <b>القرار الفوري:</b> يصدر القرار مع تقرير مفصّل ويُرسَل للمتقدم تلقائياً ✅<br><br><a href="/how-it-works.html" style="color:#10b981">اقرأ المزيد ←</a>',
    'طريقة العمل': 'طريقة عمل RAFD في 4 خطوات بسيطة 🔄<br><br>1️⃣ <b>حدّد معاييرك:</b> تُدخل جهتك معايير القبول والرفض عبر لوحة التحكم (بدون برمجة)<br>2️⃣ <b>استقبل الطلبات:</b> تُشارك رابط النموذج مع المتقدمين ليُقدّموا طلباتهم<br>3️⃣ <b>التحليل الذكي:</b> يحلّل الذكاء الاصطناعي كل طلب وفق معاييرك فورياً<br>4️⃣ <b>القرار الفوري:</b> يصدر القرار مع تقرير مفصّل ويُرسَل للمتقدم تلقائياً ✅<br><br><a href="/how-it-works.html" style="color:#10b981">اقرأ المزيد ←</a>',
    'التقييم': 'نظام التقييم في RAFD يعمل هكذا 🧠<br><br>• تُحدّد الجهة معاييرها ووزن كل معيار<br>• يُحلّل الذكاء الاصطناعي طلب المتقدم وفق هذه المعايير<br>• يُعطي كل معيار درجة من 100<br>• يحسب الدرجة الإجمالية ويقارنها بنسبة الاجتياز التي حددتها الجهة<br>• إذا تجاوز النسبة → مقبول ✅ | إذا لم يتجاوزها → مرفوض ❌<br>• الجهة تستلم فقط المتقدمين المجتازين للفحص',
    'الباقات': 'لدينا 3 باقات 📦<br><br>🟢 <b>التجريبية — مجانية 7 أيام</b><br>وصول محدود للميزات، مثالية للتجربة<br><br>🔵 <b>الأساسية — 499 ريال/شهر</b><br>حتى 500 طلب شهرياً، تقارير أساسية، دعم فني<br><br>🟣 <b>المتقدمة — 999 ريال/شهر</b><br>طلبات غير محدودة، تحليلات متقدمة، API، مدير حساب مخصص<br><br><a href="/#pricing" style="color:#10b981">مقارنة الباقات ←</a>',
    'سعر': 'لدينا 3 باقات 📦<br><br>🟢 <b>التجريبية — مجانية 7 أيام</b><br>وصول محدود للميزات<br><br>🔵 <b>الأساسية — 499 ريال/شهر</b><br>حتى 500 طلب شهرياً<br><br>🟣 <b>المتقدمة — 999 ريال/شهر</b><br>طلبات غير محدودة + API<br><br><a href="/#pricing" style="color:#10b981">تفاصيل الباقات ←</a>',
    'الأسعار': 'لدينا 3 باقات 📦<br><br>🟢 <b>التجريبية — مجانية 7 أيام</b><br>وصول محدود للميزات<br><br>🔵 <b>الأساسية — 499 ريال/شهر</b><br>حتى 500 طلب شهرياً<br><br>🟣 <b>المتقدمة — 999 ريال/شهر</b><br>طلبات غير محدودة + API<br><br><a href="/#pricing" style="color:#10b981">تفاصيل الباقات ←</a>',
    'كيف اسجل': 'لتسجيل حساب جديد 📝<br><br>1️⃣ اضغط <a href="/signup.html" style="color:#10b981">هنا للتسجيل</a><br>2️⃣ أدخل: اسمك الأول، اسم العائلة، اسم الجهة، نوع الجهة، البريد الإلكتروني، كلمة المرور<br>3️⃣ اضغط "إنشاء الحساب"<br>4️⃣ ستصلك رسالة تأكيد على بريدك ✅<br><br>التسجيل مجاني ويستغرق أقل من دقيقة!',
    'كيف ادخل': 'لتسجيل الدخول لحسابك 🔐<br><br>1️⃣ اضغط <a href="/login.html" style="color:#10b981">هنا للدخول</a><br>2️⃣ أدخل بريدك الإلكتروني وكلمة المرور<br>3️⃣ اضغط "تسجيل الدخول"<br><br>إذا نسيت كلمة المرور، اضغط "نسيت كلمة المرور" في صفحة الدخول.',
    'تسجيل': 'لتسجيل حساب جديد 📝<br><br>1️⃣ اضغط <a href="/signup.html" style="color:#10b981">هنا للتسجيل</a><br>2️⃣ أدخل بيانات جهتك<br>3️⃣ اضغط "إنشاء الحساب"<br><br>التسجيل مجاني ويستغرق أقل من دقيقة!',
    'تواصل معنا': 'يمكنك التواصل معنا عبر البريد الإلكتروني 📧<br><a href="mailto:info@rafd-digital.com" style="color:#10b981">info@rafd-digital.com</a><br><br>سيرد فريقنا خلال 24 ساعة في أيام العمل.',
    'توفير': 'نعم! تُوفّر منصة RAFD ما يصل إلى 80% من تكاليف الفرز اليدوي للطلبات — بدون أخطاء بشرية وبسرعة فورية. 💰',
    'default': 'شكراً لسؤالك! 😊 للمزيد من التفاصيل، تواصل معنا على <a href="mailto:info@rafd-digital.com" style="color:#10b981">info@rafd-digital.com</a> وسيسعدنا مساعدتك. أو يمكنك <a href="/demo-apply.html" style="color:#10b981">تجربة النظام مجاناً ←</a>'
  };

  function toggleKhalid() {
    document.getElementById('khalidPanel').classList.toggle('open');
  }

  function khSend(txt) {
    var inp = document.getElementById('khalidInput');
    var msg = txt || inp.value.trim();
    if (!msg) return;
    var msgs = document.getElementById('khalidMsgs');
    document.getElementById('khalidQuick').style.display = 'none';
    var um = document.createElement('div');
    um.className = 'kh-msg user';
    um.textContent = msg;
    msgs.appendChild(um);
    inp.value = '';
    msgs.scrollTop = msgs.scrollHeight;
    var typing = document.createElement('div');
    typing.className = 'kh-msg bot kh-typing';
    typing.innerHTML = '<span></span><span></span><span></span>';
    msgs.appendChild(typing);
    msgs.scrollTop = msgs.scrollHeight;
    setTimeout(function () {
      msgs.removeChild(typing);
      var m = msg.toLowerCase();
      var key = 'default';
      if (m.includes('اشترك') || m.includes('اشتراك')) key = 'كيف اشترك';
      else if (m.includes('كيف') && (m.includes('نبدأ') || m.includes('ابدأ') || m.includes('بداية'))) key = 'كيف أبدأ';
      else if ((m.includes('طريقة') || m.includes('كيف')) && (m.includes('عمل') || m.includes('تعملون') || m.includes('تشتغل'))) key = 'طريقة عملكم';
      else if (m.includes('تقييم') || m.includes('تقويم') || m.includes('فحص')) key = 'التقييم';
      else if (m.includes('باقات') || m.includes('باقة') || m.includes('خطط') || m.includes('خطة')) key = 'الباقات';
      else if (m.includes('سعر') || m.includes('تكلفة') || m.includes('كم يكلف') || m.includes('كم سعر')) key = 'سعر';
      else if (m.includes('سجل') || m.includes('تسجيل') || (m.includes('كيف') && m.includes('حساب'))) key = 'كيف اسجل';
      else if (m.includes('دخل') || m.includes('دخول') || m.includes('لوجين') || (m.includes('كيف') && m.includes('ادخل'))) key = 'كيف ادخل';
      else if (m.includes('تواصل') || m.includes('اتصال') || m.includes('بريد') || m.includes('ايميل') || m.includes('واتساب')) key = 'تواصل معنا';
      else if (m.includes('توفير') || m.includes('توفر') || m.includes('80')) key = 'توفير';
      else if (m.includes('منصة') || m.includes('رافد') || m.includes('rafd') || m.includes('من انتم')) key = 'ما هي المنصة';
      var bm = document.createElement('div');
      bm.className = 'kh-msg bot';
      bm.innerHTML = khReplies[key];
      msgs.appendChild(bm);
      msgs.scrollTop = msgs.scrollHeight;
    }, 1200);
  }

  var khBtn = document.querySelector('.kh-btn');
  if (khBtn) khBtn.addEventListener('click', toggleKhalid);
  var khClose = document.querySelector('.kh-close');
  if (khClose) khClose.addEventListener('click', toggleKhalid);

  document.querySelectorAll('.kh-q[data-msg]').forEach(function (el) {
    el.addEventListener('click', function () { khSend(el.dataset.msg); });
  });

  var khalidInput = document.getElementById('khalidInput');
  if (khalidInput) {
    khalidInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') khSend();
    });
  }
  var khSendBtn = document.querySelector('.kh-send');
  if (khSendBtn) khSendBtn.addEventListener('click', function () { khSend(); });
})();
