// RAFD Digital — Translation Engine
const T = {
  ar: {
    dir:'rtl', lang:'ar',
    // Navbar
    'nav.features':'المميزات','nav.how':'كيف نعمل','nav.about':'من نحن','nav.pricing':'الأسعار',
    'nav.login':'تسجيل الدخول <span style="font-size:.7rem;opacity:.7">▼</span>',
    'nav.partner-login':'دخول الشركاء','nav.partner-login-sub':'لوحة تحكم الجهات',
    'nav.admin':'الإدارة','nav.admin-sub':'دخول مشرفي النظام','nav.join':'انضم كشريك',
    // Hero
    'hero.title':'مرحباً بكم في<br><span class="gradient-text">مستقبل التقييم</span><br>الذكي',
    'hero.desc':'RAFD — منصة الذكاء الاصطناعي للتقييم الفوري. تُمكّن الشركات والبنوك والجامعات والحاضنات من أتمتة قرارات القبول والرفض بناءً على معاييرها الخاصة — بدون تحيّز.',
    'hero.cta1':'ابدأ تجربتك المجانية ←','hero.cta2':'جرّب النظام الآن',
    'hero.stat1':'جهة مسجّلة','hero.stat2':'دقة التصنيف',
    'hero.stat3':'فوري ⚡','hero.stat3-lbl':'وقت المعالجة','hero.stat4-lbl':'توفير التكاليف',
    // How
    'how.tag':'كيف يعمل النظام','how.title':'أربع خطوات لأتمتة قراراتك',
    'how.desc':'من إعداد المعايير إلى إصدار القرار — كل شيء يعمل تلقائياً بدون تدخل بشري',
    'how.s1t':'حدّد معاييرك','how.s1d':'أدخل معايير القبول والرفض الخاصة بجهتك عبر لوحة التحكم — بدون أي برمجة',
    'how.s2t':'استقبل الطلبات','how.s2d':'شارك رابط النموذج مع المتقدمين — يُقدّمون طلباتهم مباشرة عبر المنصة',
    'how.s3t':'التحليل الذكي','how.s3d':'يحلّل الذكاء الاصطناعي كل طلب ويُقيّمه وفق معاييرك بشكل فوري',
    'how.s4t':'القرار الفوري','how.s4d':'يصدر القرار تلقائياً مع تقرير مفصّل — ويُرسَل للمتقدم فوراً',
    // Features
    'feat.tag':'المميزات','feat.title':'كل ما تحتاجه في منصة واحدة',
    'feat.desc':'تقنية متقدمة مصممة خصيصاً لاحتياجات الجهات السعودية',
    'feat1t':'ذكاء اصطناعي متقدم','feat1d':'محرك تقييم ذكي يتعلم من بياناتك ويُحسّن قراراته باستمرار',
    'feat2t':'تحقق الهوية','feat2d':'التحقق من هوية المتقدمين بشكل آمن وسريع عبر منصة التحقق الرقمي',
    'feat3t':'معايير مخصصة','feat3d':'حدّد معايير القبول والرفض بدقة — وزن لكل معيار، حد أدنى، شروط إلزامية',
    'feat4t':'تقارير وتحليلات','feat4d':'لوحة تحكم شاملة بإحصائيات تفصيلية وتقارير قابلة للتصدير',
    'feat5t':'إشعارات فورية','feat5d':'إشعارات تلقائية للمتقدمين عبر البريد الإلكتروني والرسائل النصية',
    'feat6t':'حسابات مستقلة','feat6d':'كل جهة لها حساب مستقل وبيانات معزولة تماماً عن الجهات الأخرى',
    // Sectors
    'sec.tag':'القطاعات','sec.title':'مصمّم لكل القطاعات',
    'sec.desc':'سواء كنت بنكاً أو جامعة أو مسرعة أعمال — النظام يتكيّف مع احتياجاتك',
    'sec1n':'البنوك والمالية','sec1d':'فرز طلبات القروض والتمويل وفق معايير الجدارة الائتمانية',
    'sec2n':'الجامعات والتعليم','sec2d':'قبول الطلاب والمنح الدراسية وفق المعدل والمؤهلات',
    'sec3n':'المسرعات والحاضنات','sec3d':'تقييم الشركات الناشئة وفق نضج الفكرة والفريق والسوق',
    'sec4n':'التوظيف والموارد البشرية','sec4d':'فرز السير الذاتية وتقييم المتقدمين للوظائف تلقائياً',
    'sec5n':'الجهات الحكومية','sec5d':'معالجة طلبات التراخيص والدعم والبرامج الحكومية',
    'sec6n':'برامج الشراكات','sec6d':'تقييم طلبات الشراكة والتعاون وفق معايير الأهلية',
    // Pricing
    'price.tag':'الأسعار','price.title':'خطط مرنة لكل جهة',
    'trial.plan':'🎯 تجريبية','trial.price':'مجاناً','trial.period':'/ 7 أيام',
    'trial.desc':'جرّب المنصة كاملاً بدون أي التزام',
    'trial.f1':'50 طلب تجريبي','trial.f2':'رابط تقديم خاص بجهتك',
    'trial.f3':'لوحة تحكم أساسية','trial.f4':'دعم فني خلال التجربة','trial.btn':'ابدأ التجربة مجاناً',
    'basic.plan':'⚡ الأساسية','basic.desc':'للجهات المتوسطة والنامية',
    'basic.f1':'500 طلب شهرياً','basic.f2':'معايير تقييم غير محدودة',
    'basic.f3':'تحقق هوية رقمي (نفاذ)','basic.f4':'تقارير وإحصائيات',
    'basic.f5':'إشعارات SMS وبريد إلكتروني','basic.f6':'دعم فني أولوية','basic.btn':'ابدأ الآن',
    'adv.plan':'🚀 المتقدمة','adv.badge':'الأكثر طلباً ⭐','adv.desc':'للجهات الكبيرة والمتوسعة',
    'adv.f1':'طلبات غير محدودة','adv.f2':'تحليلات وذكاء اصطناعي متقدم',
    'adv.f3':'API كامل للتكامل','adv.f4':'تكاملات مخصصة',
    'adv.f5':'SLA مضمون 99.9%','adv.f6':'مدير حساب مخصص','adv.btn':'ابدأ بالمتقدمة ←',
    // CTA + Footer
    'cta.title':'جاهز لأتمتة قراراتك؟',
    'cta.desc':'انضم لأكثر من 20 جهة تستخدم Rafd لتوفير الوقت وتحسين جودة القرارات',
    'cta.btn1':'ابدأ تجربتك المجانية ←','cta.btn2':'جرّب النظام أولاً','cta.btn3':'🤝 انضم كشريك',
    'footer.desc':'منصة ذكاء اصطناعي متكاملة لأتمتة قرارات القبول والرفض — مصممة للسوق السعودي',
    'footer.platform':'المنصة','footer.features':'المميزات','footer.how':'كيف نعمل',
    'footer.pricing':'الأسعار','footer.trial':'تجربة مجانية',
    'footer.sectors':'القطاعات','footer.banks':'البنوك','footer.unis':'الجامعات',
    'footer.accel':'المسرعات','footer.gov':'الحكومية',
    'footer.company':'الشركة','footer.about':'من نحن','footer.contact':'تواصل معنا',
    'footer.privacy':'سياسة الخصوصية','footer.terms':'الشروط والأحكام',
    'footer.partners':'الشركاء','footer.prog':'برنامج الشراكة',
    'footer.reg':'سجّل كشريك','footer.plogin':'دخول الشركاء',
    'footer.copy':'© 2025 Rafd Digital. جميع الحقوق محفوظة — الرياض، المملكة العربية السعودية',
  },
  en: {
    dir:'ltr', lang:'en',
    // Navbar
    'nav.features':'Features','nav.how':'How It Works','nav.about':'About','nav.pricing':'Pricing',
    'nav.login':'Login <span style="font-size:.7rem;opacity:.7">▼</span>',
    'nav.partner-login':'Partner Login','nav.partner-login-sub':'Organization Dashboard',
    'nav.admin':'Admin','nav.admin-sub':'System Administrators','nav.join':'Join as Partner',
    // Hero
    'hero.title':'Welcome to the<br><span class="gradient-text">Future of Smart</span><br>Assessment',
    'hero.desc':'RAFD — AI-powered applicant assessment platform. Enables companies, banks, universities and incubators to automate acceptance decisions based on their own criteria — without bias.',
    'hero.cta1':'Start Free Trial →','hero.cta2':'Try the System Now',
    'hero.stat1':'Organizations','hero.stat2':'Classification Accuracy',
    'hero.stat3':'Instant ⚡','hero.stat3-lbl':'Processing Time','hero.stat4-lbl':'Cost Savings',
    // How
    'how.tag':'How It Works','how.title':'Four Steps to Automate Your Decisions',
    'how.desc':'From setting criteria to issuing decisions — everything runs automatically without human intervention',
    'how.s1t':'Set Your Criteria','how.s1d':'Enter your acceptance and rejection criteria through the dashboard — no coding required',
    'how.s2t':'Receive Applications','how.s2d':'Share the form link with applicants — they submit directly through the platform',
    'how.s3t':'Smart Analysis','how.s3d':'AI analyzes each application and evaluates it against your criteria instantly',
    'how.s4t':'Instant Decision','how.s4d':'Decision is issued automatically with a detailed report — sent to the applicant immediately',
    // Features
    'feat.tag':'Features','feat.title':'Everything You Need in One Platform',
    'feat.desc':'Advanced technology designed specifically for Saudi organizations',
    'feat1t':'Advanced AI','feat1d':'Smart evaluation engine that learns from your data and continuously improves decisions',
    'feat2t':'Identity Verification','feat2d':'Verify applicant identities securely and quickly through the digital verification platform',
    'feat3t':'Custom Criteria','feat3d':'Set acceptance and rejection criteria precisely — weight per criterion, minimum threshold, mandatory conditions',
    'feat4t':'Reports & Analytics','feat4d':'Comprehensive dashboard with detailed statistics and exportable reports',
    'feat5t':'Instant Notifications','feat5d':'Automatic notifications for applicants via email and SMS',
    'feat6t':'Isolated Accounts','feat6d':'Each organization has an independent account with data completely isolated from others',
    // Sectors
    'sec.tag':'Sectors','sec.title':'Designed for Every Sector',
    'sec.desc':'Whether you\'re a bank, university, or business accelerator — the system adapts to your needs',
    'sec1n':'Banking & Finance','sec1d':'Screen loan and financing applications based on creditworthiness criteria',
    'sec2n':'Universities & Education','sec2d':'Student admissions and scholarships based on GPA and qualifications',
    'sec3n':'Accelerators & Incubators','sec3d':'Evaluate startups based on idea maturity, team, and market fit',
    'sec4n':'HR & Recruitment','sec4d':'Screen CVs and evaluate job applicants automatically',
    'sec5n':'Government Entities','sec5d':'Process license applications, support programs, and government initiatives',
    'sec6n':'Partnership Programs','sec6d':'Evaluate partnership applications based on eligibility criteria',
    // Pricing
    'price.tag':'Pricing','price.title':'Flexible Plans for Every Organization',
    'trial.plan':'🎯 Trial','trial.price':'Free','trial.period':'/ 7 days',
    'trial.desc':'Try the full platform with no commitment',
    'trial.f1':'50 trial applications','trial.f2':'Custom application link',
    'trial.f3':'Basic dashboard','trial.f4':'Support during trial','trial.btn':'Start Free Trial',
    'basic.plan':'⚡ Basic','basic.desc':'For mid-sized and growing organizations',
    'basic.f1':'500 applications/month','basic.f2':'Unlimited evaluation criteria',
    'basic.f3':'Digital identity verification','basic.f4':'Reports & analytics',
    'basic.f5':'SMS & email notifications','basic.f6':'Priority support','basic.btn':'Get Started',
    'adv.plan':'🚀 Advanced','adv.badge':'Most Popular ⭐','adv.desc':'For large and expanding organizations',
    'adv.f1':'Unlimited applications','adv.f2':'Advanced AI & analytics',
    'adv.f3':'Full API integration','adv.f4':'Custom integrations',
    'adv.f5':'Guaranteed 99.9% SLA','adv.f6':'Dedicated account manager','adv.btn':'Start Advanced →',
    // CTA + Footer
    'cta.title':'Ready to Automate Your Decisions?',
    'cta.desc':'Join 20+ organizations using Rafd to save time and improve decision quality',
    'cta.btn1':'Start Free Trial →','cta.btn2':'Try the System First','cta.btn3':'🤝 Join as Partner',
    'footer.desc':'Integrated AI platform for automating acceptance and rejection decisions — designed for the Saudi market',
    'footer.platform':'Platform','footer.features':'Features','footer.how':'How It Works',
    'footer.pricing':'Pricing','footer.trial':'Free Trial',
    'footer.sectors':'Sectors','footer.banks':'Banks','footer.unis':'Universities',
    'footer.accel':'Accelerators','footer.gov':'Government',
    'footer.company':'Company','footer.about':'About Us','footer.contact':'Contact Us',
    'footer.privacy':'Privacy Policy','footer.terms':'Terms & Conditions',
    'footer.partners':'Partners','footer.prog':'Partnership Program',
    'footer.reg':'Register as Partner','footer.plogin':'Partner Login',
    'footer.copy':'© 2025 Rafd Digital. All rights reserved — Riyadh, Saudi Arabia',
  }
};

function setLang(lang) {
  const isAR = lang === 'ar';
  document.documentElement.lang = lang;
  document.documentElement.dir = isAR ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (T[lang] && T[lang][key] !== undefined) el.innerHTML = T[lang][key];
  });
  const btn = document.getElementById('langToggleBtn');
  if (btn) btn.textContent = isAR ? '🌐 EN' : '🌐 عربي';
  localStorage.setItem('rafd_lang', lang);
}

document.addEventListener('DOMContentLoaded', function() {
  const saved = localStorage.getItem('rafd_lang') || 'ar';
  const btn = document.getElementById('langToggleBtn');
  if (btn) btn.textContent = saved === 'ar' ? '🌐 EN' : '🌐 عربي';
  if (saved !== 'ar') setLang(saved);
});
