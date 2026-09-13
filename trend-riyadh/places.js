// ============================================================
// ترند الرياض — قاعدة بيانات الأماكن (النسخة الأولية)
// ------------------------------------------------------------
// كل مكان = كائن واحد. لإضافة مكان جديد انسخ أي كائن وعدّله.
//
// الحقول:
//   id          معرّف فريد (حروف إنجليزية وأرقام وشرطات)
//   name        الاسم بالعربي
//   nameEn      الاسم بالإنجليزي (اختياري — يساعد في البحث وفي إيجاد المكان في قوقل)
//   sec         القسم الرئيسي — من RIYADH_SECTIONS
//   sub         القسم الفرعي — من subs داخل القسم
//   audience    الجمهور: men | women | family | all
//   district    north | center | east | west | south | outside
//   area        الحي أو الشارع
//   price       1 اقتصادي، 2 متوسط، 3 فاخر
//   tags        وسوم حرّة تظهر على البطاقة
//   trend       true = "ترند الآن" (قرار المشرف — لا يُباع)
//   sponsored   true = مكان مدفوع/شريك — يظهر بشارة "إعلان" ولا يدخل الترند أبدًا
//   recommendedBy  اسم/حساب الشخص الذي أوصى بالمكان (يظهر على البطاقة)
//   placeId     معرّف المكان في قوقل (Place ID) — به يُجلب تقييم قوقل حيًّا
//               احصل عليه من: https://developers.google.com/maps/documentation/places/web-service/place-id
//               أو شغّل tools/find-place-ids.js بعد وضع مفتاح قوقل.
//   addedAt     تاريخ الإضافة YYYY-MM-DD — خلال 45 يوم يأخذ شارة "جديد"
//   endsAt      للفعاليات فقط: تاريخ الانتهاء — يختفي بعده تلقائيًا
//   desc        وصف قصير
//   ig          حساب انستقرام بدون @
//   maps        نص البحث في خرائط قوقل إذا كان الاسم غير كافٍ
//   verified    true فقط بعد التحقق ميدانيًا أو من مصدر رسمي
//   demo        true = إدخال توضيحي يجب استبداله قبل النشر
//
// ⚠️ لا نخزّن تقييمات قوقل هنا أبدًا — سياسة قوقل تمنع تخزينها وتسمح بتخزين
//    placeId فقط. التقييم يُجلب لحظيًا عند فتح صفحة المكان.
// ============================================================

window.RIYADH_SECTIONS = [
  { id: 'men', label: 'للشباب', icon: '🧢', desc: 'أماكن ومحلات يقصدها الشباب', subs: [
    { id: 'thobes', label: 'بدل وثياب رجالية' }, { id: 'barber', label: 'حلاقين وصالونات رجالية' },
    { id: 'tea', label: 'ديوانيات شاي' }, { id: 'cafe', label: 'كافيهات شبابية' }, { id: 'food', label: 'مطاعم شبابية' },
    { id: 'football', label: 'أكاديميات كرة ورياضة' }, { id: 'gym', label: 'جيم ونوادي' }, { id: 'gaming', label: 'ألعاب وبلياردو وبلايستيشن' },
    { id: 'perfume', label: 'عطور وعود' }, { id: 'cars', label: 'سيارات وتعديل' } ] },
  { id: 'women', label: 'للبنات', icon: '👗', desc: 'صالونات ومحلات وأماكن للبنات', subs: [
    { id: 'salon', label: 'صالونات وتجميل' }, { id: 'fashion', label: 'ملابس وعبايات' }, { id: 'cafe', label: 'كافيهات بناتية' },
    { id: 'food', label: 'مطاعم بناتية' }, { id: 'gym', label: 'نوادي نسائية' }, { id: 'jewelry', label: 'إكسسوارات ومجوهرات' },
    { id: 'studio', label: 'استوديوهات تصوير' } ] },
  { id: 'beauty', label: 'صحة وجمال', icon: '💆', desc: 'عيادات وسبا وليزر', subs: [
    { id: 'derma', label: 'عيادات جلدية وتجميل' }, { id: 'spa', label: 'سبا ومساج' }, { id: 'laser', label: 'ليزر وعناية' }, { id: 'dental', label: 'أسنان تجميلي' } ] },
  { id: 'cafe', label: 'كافيهات', icon: '☕', desc: 'قهوة مختصة وجلسات', subs: [
    { id: 'specialty', label: 'قهوة مختصة' }, { id: 'night', label: 'كافيهات ليلية' }, { id: 'tea', label: 'شاي وكرك' },
    { id: 'outdoor', label: 'جلسات خارجية' }, { id: 'work', label: 'للدراسة والعمل' } ] },
  { id: 'restaurant', label: 'مطاعم', icon: '🍽️', desc: 'من الشعبي إلى الفاخر', subs: [
    { id: 'saudi', label: 'سعودي وشعبي' }, { id: 'burger', label: 'برجر' }, { id: 'pizza', label: 'بيتزا وإيطالي' }, { id: 'grill', label: 'مشاوي' },
    { id: 'asian', label: 'آسيوي وياباني' }, { id: 'fine', label: 'فاخر' }, { id: 'breakfast', label: 'فطور' }, { id: 'shawarma', label: 'شاورما وسريع' }, { id: 'lebanese', label: 'لبناني وشامي' } ] },
  { id: 'sweets', label: 'حلويات', icon: '🍰', desc: 'آيسكريم وكيك وشرقي', subs: [
    { id: 'icecream', label: 'آيسكريم' }, { id: 'bakery', label: 'كيك ومخبوزات' }, { id: 'oriental', label: 'حلويات شرقية' }, { id: 'chocolate', label: 'شوكولاتة' }, { id: 'dates', label: 'تمور' } ] },
  { id: 'destination', label: 'وجهات وسكويرات', icon: '🎡', desc: 'مماشي وترفيه وتراث', subs: [
    { id: 'square', label: 'سكويرات ومماشي' }, { id: 'fun', label: 'ترفيه ومغامرات' }, { id: 'heritage', label: 'تراث ومتاحف' },
    { id: 'nature', label: 'حدائق وطبيعة' }, { id: 'cinema', label: 'سينما' }, { id: 'art', label: 'معارض وفن' } ] },
  { id: 'market', label: 'أسواق ومولات', icon: '🛍️', desc: 'مولات وأسواق شعبية', subs: [
    { id: 'mall', label: 'مولات' }, { id: 'souq', label: 'أسواق شعبية' }, { id: 'boutique', label: 'بوتيكات' }, { id: 'outlet', label: 'أوتلت وتخفيضات' } ] },
  { id: 'kids', label: 'أطفال', icon: '🧸', desc: 'ألعاب وترفيه ومحلات', subs: [
    { id: 'indoor', label: 'ألعاب داخلية' }, { id: 'park', label: 'ملاهي' }, { id: 'shop', label: 'محلات أطفال' }, { id: 'edu', label: 'تعليم وأنشطة' } ] },
  { id: 'chalet', label: 'شاليهات واستراحات', icon: '🏡', desc: 'للأطفال، فخمة، للمناسبات', subs: [
    { id: 'kids', label: 'شاليهات للأطفال (ألعاب)' }, { id: 'luxury', label: 'شاليهات فخمة' }, { id: 'events', label: 'شاليهات مناسبات' },
    { id: 'rest', label: 'استراحات شباب' }, { id: 'farm', label: 'مزارع' } ] },
  { id: 'venue', label: 'قاعات وأفراح', icon: '💍', desc: 'قاعات جديدة ومناسبات', subs: [
    { id: 'wedding', label: 'قاعات أفراح' }, { id: 'small', label: 'قاعات مناسبات صغيرة' }, { id: 'hotel', label: 'فنادق للأفراح' }, { id: 'planner', label: 'تنظيم وكوش' } ] },
  { id: 'hotel', label: 'فنادق', icon: '🏨', desc: 'فاخرة ومتوسطة وشقق', subs: [
    { id: 'luxury', label: 'فاخرة' }, { id: 'mid', label: 'متوسطة' }, { id: 'apart', label: 'شقق فندقية' }, { id: 'resort', label: 'منتجعات' } ] },
  { id: 'event', label: 'فعاليات', icon: '🎉', desc: 'هذا الأسبوع ومواسم', subs: [
    { id: 'week', label: 'هذا الأسبوع' }, { id: 'season', label: 'مواسم' }, { id: 'concert', label: 'حفلات' }, { id: 'expo', label: 'معارض' } ] },
];

window.RIYADH_DISTRICTS = [
  { id: 'all', label: 'كل الرياض' }, { id: 'north', label: 'شمال' }, { id: 'center', label: 'وسط' },
  { id: 'east', label: 'شرق' }, { id: 'west', label: 'غرب' }, { id: 'south', label: 'جنوب' }, { id: 'outside', label: 'خارج المدينة' },
];

window.RIYADH_PLACES = [
  // ================= للشباب =================
  { id: 'lomar', name: 'لومار', nameEn: 'Lomar', sec: 'men', sub: 'thobes', audience: 'men', district: 'north', area: 'عدة فروع', price: 3, tags: ['ثياب عصرية', 'تصميم سعودي'], trend: false, addedAt: '2026-05-01', desc: 'علامة سعودية للثوب العصري بتصاميم مختلفة عن التقليدي.', ig: 'lomar', verified: false },
  { id: 'men-thobe-demo', name: 'محل بدل رجالية (مثال — استبدله)', sec: 'men', sub: 'thobes', audience: 'men', district: 'center', area: 'العليا', price: 2, tags: ['بدل', 'تفصيل'], trend: true, addedAt: '2026-09-01', desc: 'إدخال توضيحي: استبدله بمحل بدل أو تفصيل يقصده الشباب حاليًا.', verified: false, demo: true },
  { id: 'barber-demo', name: 'صالون رجالي (مثال — استبدله)', sec: 'men', sub: 'barber', audience: 'men', district: 'east', area: 'الروضة', price: 1, tags: ['حلاقة', 'حجز أونلاين'], trend: true, addedAt: '2026-09-01', desc: 'إدخال توضيحي: استبدله بحلاق مشهور بين الشباب.', verified: false, demo: true },
  { id: 'tea-club', name: 'تي كلوب', nameEn: 'Tea Club', sec: 'men', sub: 'tea', audience: 'all', district: 'north', area: 'عدة فروع', price: 2, tags: ['شاي', 'جلسات', 'شباب'], trend: false, addedAt: '2026-06-01', desc: 'سلسلة متخصصة في الشاي بأنواعه وجلسات هادئة.', verified: false },
  { id: 'tea-diwaniya-demo', name: 'ديوانية شاي (مثال — استبدله)', sec: 'men', sub: 'tea', audience: 'men', district: 'north', area: 'الياسمين', price: 1, tags: ['شاي احترافي', 'ديوانية', 'سهرات'], trend: true, addedAt: '2026-09-05', desc: 'إدخال توضيحي: أضف الديوانيات التي يضبطون فيها الشاي ويقصدها الشباب.', verified: false, demo: true },
  { id: 'fitness-time', name: 'وقت اللياقة', nameEn: 'Fitness Time', sec: 'men', sub: 'gym', audience: 'men', district: 'north', area: 'عدة فروع', price: 2, tags: ['جيم', 'سباحة', 'الأكبر'], trend: false, addedAt: '2026-05-01', desc: 'أكبر سلسلة نوادي رياضية في السعودية — فروع في كل أحياء الرياض.', verified: false },
  { id: 'body-masters', name: 'بودي ماسترز', nameEn: 'Body Masters', sec: 'men', sub: 'gym', audience: 'men', district: 'north', area: 'عدة فروع', price: 2, tags: ['جيم', 'كمال أجسام'], trend: false, addedAt: '2026-05-01', desc: 'سلسلة نوادي رياضية سعودية.', verified: false },
  { id: 'football-academy-demo', name: 'أكاديمية كرة قدم (مثال — استبدله)', sec: 'men', sub: 'football', audience: 'men', district: 'north', area: 'الرياض', price: 2, tags: ['كرة قدم', 'تدريب', 'ملاعب'], trend: false, addedAt: '2026-09-01', desc: 'إدخال توضيحي: أضف أكاديميات الكرة وملاعب الإيجار الشبابية.', verified: false, demo: true },
  { id: 'gaming-demo', name: 'صالة بلياردو وبلايستيشن (مثال — استبدله)', sec: 'men', sub: 'gaming', audience: 'men', district: 'east', area: 'الرياض', price: 1, tags: ['بلياردو', 'قيمنق'], trend: false, addedAt: '2026-09-01', desc: 'إدخال توضيحي.', verified: false, demo: true },
  { id: 'abdul-samad', name: 'عبدالصمد القرشي', nameEn: 'Abdul Samad Al Qurashi', sec: 'men', sub: 'perfume', audience: 'all', district: 'center', area: 'عدة فروع', price: 3, tags: ['عود', 'عطور', 'هدايا'], trend: false, addedAt: '2026-05-01', desc: 'من أعرق بيوت العود والعطور في السعودية.', verified: false },
  { id: 'arabian-oud', name: 'العربية للعود', nameEn: 'Arabian Oud', sec: 'men', sub: 'perfume', audience: 'all', district: 'center', area: 'عدة فروع', price: 2, tags: ['عود', 'عطور'], trend: false, addedAt: '2026-05-01', desc: 'أكبر سلسلة عود وعطور بفروع في كل المولات.', verified: false },
  { id: 'cars-demo', name: 'ورشة تعديل سيارات (مثال — استبدله)', sec: 'men', sub: 'cars', audience: 'men', district: 'south', area: 'الرياض', price: 2, tags: ['تعديل', 'عناية'], trend: false, addedAt: '2026-09-01', desc: 'إدخال توضيحي.', verified: false, demo: true },

  // ================= للبنات =================
  { id: 'salon-demo', name: 'صالون نسائي (مثال — استبدله)', sec: 'women', sub: 'salon', audience: 'women', district: 'north', area: 'الياسمين', price: 2, tags: ['شعر', 'أظافر', 'حجز أونلاين'], trend: true, addedAt: '2026-09-01', desc: 'إدخال توضيحي: الصالونات تتغير بسرعة — اجمعها من توصيات مباشرة.', verified: false, demo: true },
  { id: 'femi9', name: 'فيمي ناين', nameEn: 'Femi9', sec: 'women', sub: 'fashion', audience: 'women', district: 'north', area: 'عدة فروع', price: 2, tags: ['ملابس', 'سعودي'], trend: false, addedAt: '2026-05-01', desc: 'علامة أزياء نسائية سعودية بفروع في المولات.', ig: 'femi9', verified: false },
  { id: 'abadia', name: 'عبادية', nameEn: 'Abadia', sec: 'women', sub: 'fashion', audience: 'women', district: 'north', area: 'الرياض', price: 3, tags: ['عبايات', 'تصميم سعودي'], trend: false, addedAt: '2026-05-01', desc: 'علامة سعودية لتصاميم العبايات والأزياء المعاصرة.', ig: 'abadia', verified: false },
  { id: 'rubaiyat', name: 'رباعيات', nameEn: 'Rubaiyat', sec: 'women', sub: 'fashion', audience: 'women', district: 'center', area: 'مركز المملكة', price: 3, tags: ['ماركات فاخرة', 'فساتين'], trend: false, addedAt: '2026-05-01', desc: 'بوتيك ماركات فاخرة للنساء.', verified: false },
  { id: 'lazurde', name: 'لازوردي', nameEn: "L'azurde", sec: 'women', sub: 'jewelry', audience: 'women', district: 'center', area: 'عدة فروع', price: 3, tags: ['ذهب', 'مجوهرات', 'سعودي'], trend: false, addedAt: '2026-05-01', desc: 'أكبر علامة مجوهرات سعودية.', verified: false },
  { id: 'women-cafe-demo', name: 'كافيه بناتي (مثال — استبدله)', sec: 'women', sub: 'cafe', audience: 'women', district: 'north', area: 'الملقا', price: 2, tags: ['للتصوير', 'ترند تيك توك'], trend: true, addedAt: '2026-09-05', desc: 'إدخال توضيحي: كافيهات تقصدها البنات وتشتهر في تيك توك.', verified: false, demo: true },
  { id: 'women-gym', name: 'وقت اللياقة — سيدات', nameEn: 'Fitness Time Ladies', sec: 'women', sub: 'gym', audience: 'women', district: 'north', area: 'عدة فروع', price: 2, tags: ['نادي نسائي', 'سباحة'], trend: false, addedAt: '2026-05-01', desc: 'فروع نسائية من أكبر سلسلة نوادي في السعودية.', verified: false },
  { id: 'studio-demo', name: 'استوديو تصوير (مثال — استبدله)', sec: 'women', sub: 'studio', audience: 'women', district: 'north', area: 'الرياض', price: 2, tags: ['تصوير', 'مناسبات'], trend: false, addedAt: '2026-09-01', desc: 'إدخال توضيحي.', verified: false, demo: true },

  // ================= صحة وجمال =================
  { id: 'derma-clinic', name: 'عيادات ديرما', nameEn: 'Derma Clinic', sec: 'beauty', sub: 'derma', audience: 'all', district: 'north', area: 'عدة فروع', price: 3, tags: ['جلدية', 'تجميل', 'ليزر'], trend: false, addedAt: '2026-05-01', desc: 'سلسلة عيادات جلدية وتجميل معروفة في الرياض.', verified: false },
  { id: 'spa-ritz', name: 'سبا الريتز كارلتون', nameEn: 'The Ritz-Carlton Spa Riyadh', sec: 'beauty', sub: 'spa', audience: 'all', district: 'west', area: 'الحدا', price: 3, tags: ['سبا', 'فاخر'], trend: false, addedAt: '2026-05-01', desc: 'سبا فندقي فاخر.', verified: false },
  { id: 'laser-demo', name: 'مركز ليزر (مثال — استبدله)', sec: 'beauty', sub: 'laser', audience: 'women', district: 'north', area: 'الرياض', price: 2, tags: ['ليزر', 'عناية'], trend: false, addedAt: '2026-09-01', desc: 'إدخال توضيحي.', verified: false, demo: true },

  // ================= كافيهات =================
  { id: 'elixir-bunn', name: 'إلكسر بن', nameEn: 'Elixir Bunn', sec: 'cafe', sub: 'specialty', audience: 'all', district: 'north', area: 'عدة فروع', price: 2, tags: ['قهوة مختصة'], trend: false, addedAt: '2026-06-01', desc: 'من أوائل كافيهات القهوة المختصة في الرياض.', ig: 'elixirbunn', verified: false },
  { id: 'half-million', name: 'هاف مليون', nameEn: 'Half Million', sec: 'cafe', sub: 'specialty', audience: 'all', district: 'north', area: 'عدة فروع', price: 2, tags: ['تصميم', 'للتصوير'], trend: true, addedAt: '2026-08-15', desc: 'كافيه سعودي بتصميم مميز، مشهور بين الشباب والبنات.', ig: 'halfmillion', verified: false },
  { id: 'camel-step', name: 'خطوة جمل', nameEn: 'Camel Step', sec: 'cafe', sub: 'specialty', audience: 'all', district: 'north', area: 'عدة فروع', price: 2, tags: ['محمصة'], trend: false, addedAt: '2026-06-01', desc: 'محمصة سعودية معروفة — قهوة مختصة وبيع حبوب.', ig: 'camelstep', verified: false },
  { id: 'dose-cafe', name: 'دوز كافيه', nameEn: 'Dose Cafe', sec: 'cafe', sub: 'specialty', audience: 'all', district: 'north', area: 'عدة فروع', price: 2, tags: ['فروع كثيرة'], trend: false, addedAt: '2026-06-01', desc: 'سلسلة كافيهات سعودية بفروع كثيرة.', ig: 'dose_cafe', verified: false },
  { id: 'arabica', name: '٪ أرابيكا', nameEn: '% Arabica Riyadh', sec: 'cafe', sub: 'specialty', audience: 'all', district: 'north', area: 'الرياض', price: 2, tags: ['عالمي', 'للتصوير'], trend: true, addedAt: '2026-08-01', desc: 'فرع الرياض من العلامة اليابانية الشهيرة.', verified: false },
  { id: 'urth-caffe', name: 'أورث كافيه', nameEn: 'Urth Caffé Riyadh', sec: 'cafe', sub: 'work', audience: 'all', district: 'north', area: 'الرياض', price: 2, tags: ['فطور', 'أورقانيك'], trend: false, addedAt: '2026-06-01', desc: 'كافيه أمريكي عضوي — فطور وقهوة.', verified: false },
  { id: 'draft-cafe', name: 'درافت كافيه', nameEn: 'Draft Cafe', sec: 'cafe', sub: 'outdoor', audience: 'all', district: 'north', area: 'شمال الرياض', price: 2, tags: ['جلسات خارجية'], trend: false, addedAt: '2026-06-01', desc: 'كافيه بجلسات خارجية مناسب في الجو المعتدل.', verified: false },
  { id: 'brew92', name: 'برو ٩٢', nameEn: 'Brew92', sec: 'cafe', sub: 'specialty', audience: 'all', district: 'north', area: 'عدة فروع', price: 2, tags: ['قهوة مختصة'], trend: false, addedAt: '2026-06-01', desc: 'علامة قهوة مختصة سعودية.', ig: 'brew92', verified: false },
  { id: 'night-cafe-demo', name: 'كافيه ليلي (مثال — استبدله)', sec: 'cafe', sub: 'night', audience: 'men', district: 'north', area: 'الرياض', price: 2, tags: ['24 ساعة', 'سهرات'], trend: false, addedAt: '2026-09-01', desc: 'إدخال توضيحي.', verified: false, demo: true },

  // ================= مطاعم =================
  { id: 'najd-village', name: 'قرية نجد التراثية', nameEn: 'Najd Village', sec: 'restaurant', sub: 'saudi', audience: 'family', district: 'north', area: 'عدة فروع', price: 2, tags: ['أكل نجدي', 'سياح', 'تراث'], trend: false, addedAt: '2026-05-01', desc: 'أشهر مطعم أكل شعبي نجدي بجلسات تراثية.', ig: 'najdvillage', verified: false },
  { id: 'romansiah', name: 'الرومانسية', nameEn: 'Al Romansiah', sec: 'restaurant', sub: 'saudi', audience: 'family', district: 'east', area: 'عدة فروع', price: 1, tags: ['مندي', 'كبسة', 'عوائل'], trend: false, addedAt: '2026-05-01', desc: 'سلسلة مطاعم سعودية شعبية — مندي وكبسة بأسعار مناسبة.', verified: false },
  { id: 'mama-noura', name: 'ماما نورة', nameEn: 'Mama Noura', sec: 'restaurant', sub: 'shawarma', audience: 'all', district: 'north', area: 'عدة فروع', price: 1, tags: ['شاورما', 'عصائر', 'أيقونة'], trend: false, addedAt: '2026-05-01', desc: 'أيقونة شاورما الرياض.', verified: false },
  { id: 'shawarmer', name: 'شاورمر', nameEn: 'Shawarmer', sec: 'restaurant', sub: 'shawarma', audience: 'all', district: 'north', area: 'عدة فروع', price: 1, tags: ['شاورما', 'سعودي'], trend: false, addedAt: '2026-05-01', desc: 'سلسلة شاورما سعودية بدأت من الرياض.', verified: false },
  { id: 'albaik', name: 'البيك', nameEn: 'Albaik', sec: 'restaurant', sub: 'shawarma', audience: 'all', district: 'east', area: 'عدة فروع', price: 1, tags: ['دجاج', 'الأشهر'], trend: false, addedAt: '2026-05-01', desc: 'الأيقونة السعودية — فروع منتشرة في الرياض.', verified: false },
  { id: 'herfy', name: 'هرفي', nameEn: 'Herfy', sec: 'restaurant', sub: 'burger', audience: 'all', district: 'center', area: 'عدة فروع', price: 1, tags: ['برجر', 'سعودي'], trend: false, addedAt: '2026-05-01', desc: 'أقدم سلسلة برجر سعودية.', verified: false },
  { id: 'section-b', name: 'سكشن بي', nameEn: 'Section-B', sec: 'restaurant', sub: 'burger', audience: 'men', district: 'north', area: 'عدة فروع', price: 2, tags: ['برجر', 'شباب'], trend: false, addedAt: '2026-05-01', desc: 'برجر سعودي شبابي بفروع في الرياض.', verified: false },
  { id: 'burgerizzr', name: 'برجرايزر', nameEn: 'Burgerizzr', sec: 'restaurant', sub: 'burger', audience: 'all', district: 'north', area: 'عدة فروع', price: 1, tags: ['برجر', 'سعودي'], trend: false, addedAt: '2026-05-01', desc: 'سلسلة برجر سعودية.', verified: false },
  { id: 'maestro-pizza', name: 'مايسترو بيتزا', nameEn: 'Maestro Pizza', sec: 'restaurant', sub: 'pizza', audience: 'all', district: 'north', area: 'عدة فروع', price: 1, tags: ['بيتزا'], trend: false, addedAt: '2026-05-01', desc: 'سلسلة بيتزا سعودية انطلقت من الرياض.', verified: false },
  { id: 'lpm-riyadh', name: 'إل بي إم', nameEn: 'LPM Riyadh', sec: 'restaurant', sub: 'fine', audience: 'all', district: 'north', area: 'فيا رياض — حطين', price: 3, tags: ['فرنسي', 'حجز مسبق'], trend: true, addedAt: '2026-08-01', desc: 'مطعم فرنسي عالمي في فيا رياض.', verified: false },
  { id: 'nusret', name: 'نصرت', nameEn: 'Nusr-Et Riyadh', sec: 'restaurant', sub: 'grill', audience: 'all', district: 'center', area: 'العليا', price: 3, tags: ['ستيك', 'فاخر'], trend: false, addedAt: '2026-05-01', desc: 'فرع الرياض من سلسلة الستيك العالمية.', verified: false },
  { id: 'myazu', name: 'مايازو', nameEn: 'Myazu', sec: 'restaurant', sub: 'asian', audience: 'all', district: 'center', area: 'العليا', price: 3, tags: ['ياباني', 'فاخر'], trend: false, addedAt: '2026-05-01', desc: 'مطعم ياباني راقي.', verified: false },
  { id: 'nozomi', name: 'نوزومي', nameEn: 'Nozomi Riyadh', sec: 'restaurant', sub: 'asian', audience: 'all', district: 'center', area: 'الرياض', price: 3, tags: ['ياباني', 'فاخر'], trend: false, addedAt: '2026-05-01', desc: 'مطعم ياباني فاخر.', verified: false },
  { id: 'lusin', name: 'لوسين', nameEn: 'Lusin', sec: 'restaurant', sub: 'fine', audience: 'family', district: 'center', area: 'سنتريا مول — العليا', price: 3, tags: ['أرمني', 'عوائل'], trend: false, addedAt: '2026-05-01', desc: 'مطبخ أرمني راقي — من الأسماء الثابتة في الرياض.', verified: false },
  { id: 'zaatar-w-zeit', name: 'زعتر وزيت', nameEn: 'Zaatar w Zeit', sec: 'restaurant', sub: 'lebanese', audience: 'all', district: 'north', area: 'عدة فروع', price: 1, tags: ['لبناني', 'فطور', 'سريع'], trend: false, addedAt: '2026-05-01', desc: 'مناقيش وأكل لبناني سريع.', verified: false },
  { id: 'villa-mamas', name: 'فيلا ماماز', nameEn: 'Villa Mamas', sec: 'restaurant', sub: 'breakfast', audience: 'family', district: 'north', area: 'الرياض', price: 2, tags: ['فطور', 'خليجي', 'بيتي'], trend: false, addedAt: '2026-05-01', desc: 'أكل خليجي بيتي — مشهور بالفطور.', verified: false },
  { id: 'tahlia-street', name: 'شارع التحلية', nameEn: 'Tahlia Street', sec: 'restaurant', sub: 'fine', audience: 'all', district: 'center', area: 'العليا / السليمانية', price: 2, tags: ['شارع مطاعم', 'ليلي'], trend: false, addedAt: '2026-05-01', desc: 'أشهر شارع مطاعم وكافيهات في الرياض.', verified: false },

  // ================= حلويات =================
  { id: 'saddle', name: 'سادل', nameEn: 'Saddle', sec: 'sweets', sub: 'icecream', audience: 'all', district: 'north', area: 'شمال الرياض', price: 2, tags: ['آيسكريم', 'قهوة', 'طوابير'], trend: true, addedAt: '2026-08-20', desc: 'كافيه سعودي مشهور بالآيسكريم والقهوة.', ig: 'saddle', verified: false },
  { id: 'home-bakery', name: 'هوم بيكري', nameEn: 'Home Bakery', sec: 'sweets', sub: 'bakery', audience: 'all', district: 'north', area: 'عدة فروع', price: 2, tags: ['كيك', 'فطور'], trend: false, addedAt: '2026-05-01', desc: 'مخبز سعودي من الرياض — كيك وفطور.', verified: false },
  { id: 'munch-bakery', name: 'منش بيكري', nameEn: 'Munch Bakery', sec: 'sweets', sub: 'bakery', audience: 'all', district: 'north', area: 'عدة فروع', price: 2, tags: ['كيك', 'مخبوزات'], trend: false, addedAt: '2026-05-01', desc: 'مخبز سعودي مشهور بالكيك.', ig: 'munchbakery', verified: false },
  { id: 'saadeddin', name: 'سعد الدين', nameEn: 'Saadeddin', sec: 'sweets', sub: 'oriental', audience: 'family', district: 'east', area: 'عدة فروع', price: 2, tags: ['كنافة', 'شرقية'], trend: false, addedAt: '2026-05-01', desc: 'حلويات شرقية وكنافة بفروع كثيرة.', verified: false },
  { id: 'patchi', name: 'باتشي', nameEn: 'Patchi', sec: 'sweets', sub: 'chocolate', audience: 'all', district: 'center', area: 'عدة فروع', price: 3, tags: ['شوكولاتة', 'هدايا'], trend: false, addedAt: '2026-05-01', desc: 'شوكولاتة فاخرة للهدايا والمناسبات.', verified: false },
  { id: 'chocomelt', name: 'شوكوميلت', nameEn: 'Chocomelt', sec: 'sweets', sub: 'chocolate', audience: 'all', district: 'north', area: 'عدة فروع', price: 2, tags: ['وافل', 'سهرات'], trend: false, addedAt: '2026-05-01', desc: 'حلويات شوكولاتة ووافل.', verified: false },
  { id: 'bateel', name: 'بتيل', nameEn: 'Bateel', sec: 'sweets', sub: 'dates', audience: 'all', district: 'center', area: 'عدة فروع', price: 3, tags: ['تمور فاخرة', 'هدايا'], trend: false, addedAt: '2026-05-01', desc: 'تمور وشوكولاتة فاخرة — أفضل هدية سعودية للزوار.', ig: 'bateel', verified: false },

  // ================= وجهات =================
  { id: 'boulevard-city', name: 'بوليفارد رياض سيتي', nameEn: 'Boulevard Riyadh City', sec: 'destination', sub: 'square', audience: 'family', district: 'north', area: 'حطين', price: 2, tags: ['ليلي', 'مطاعم', 'فعاليات'], trend: true, addedAt: '2026-08-20', desc: 'أكبر وجهة ترفيه في الرياض: مطاعم عالمية، مسارح، وعروض ليلية.', ig: 'boulevardcity', verified: false },
  { id: 'boulevard-world', name: 'بوليفارد وورلد', nameEn: 'Boulevard World', sec: 'destination', sub: 'fun', audience: 'family', district: 'north', area: 'قرب بوليفارد سيتي', price: 2, tags: ['موسمي', 'دول العالم'], trend: true, addedAt: '2026-08-20', desc: 'مناطق مستوحاة من دول العالم حول بحيرة — يفتح خلال موسم الرياض.', verified: false },
  { id: 'via-riyadh', name: 'فيا رياض', nameEn: 'VIA Riyadh', sec: 'destination', sub: 'square', audience: 'all', district: 'north', area: 'حطين', price: 3, tags: ['فاخر', 'سينما'], trend: true, addedAt: '2026-07-01', desc: 'وجهة فاخرة تجمع مطاعم عالمية وبوتيكات وسينما.', ig: 'viariyadh', verified: false },
  { id: 'u-walk', name: 'يو ووك', nameEn: 'U Walk', sec: 'destination', sub: 'square', audience: 'all', district: 'north', area: 'طريق أنس بن مالك', price: 2, tags: ['ممشى', 'كافيهات'], trend: false, addedAt: '2026-06-15', desc: 'ممشى مفتوح فيه كافيهات ومطاعم ومحلات.', verified: false },
  { id: 'riyadh-front', name: 'الرياض فرونت', nameEn: 'Riyadh Front', sec: 'destination', sub: 'square', audience: 'family', district: 'north', area: 'طريق المطار', price: 2, tags: ['مطاعم', 'مفتوح'], trend: false, addedAt: '2026-06-15', desc: 'منطقة مطاعم وكافيهات مفتوحة قرب طريق المطار.', verified: false },
  { id: 'the-zone', name: 'ذا زون', nameEn: 'The Zone', sec: 'destination', sub: 'square', audience: 'men', district: 'north', area: 'شمال الرياض', price: 2, tags: ['شباب', 'مسائي'], trend: false, addedAt: '2026-06-15', desc: 'ساحة مفتوحة تجمع مطاعم وكافيهات عصرية.', verified: false },
  { id: 'bujairi', name: 'حي البجيري — الدرعية', nameEn: 'Bujairi Terrace', sec: 'destination', sub: 'heritage', audience: 'all', district: 'west', area: 'الدرعية', price: 3, tags: ['تراث', 'إطلالة', 'للتصوير'], trend: true, addedAt: '2026-08-01', desc: 'مطاعم عالمية بإطلالة على حي الطريف التاريخي.', ig: 'bujairi', verified: false },
  { id: 'jax', name: 'حي جاكس', nameEn: 'JAX District', sec: 'destination', sub: 'art', audience: 'all', district: 'west', area: 'الدرعية', price: 1, tags: ['فن', 'معارض', 'بينالي'], trend: true, addedAt: '2026-08-10', desc: 'حي فني في الدرعية — معارض وبينالي الدرعية واستوديوهات.', verified: false },
  { id: 'kafd', name: 'كافد', nameEn: 'KAFD', sec: 'destination', sub: 'square', audience: 'all', district: 'north', area: 'العقيق', price: 3, tags: ['عمارة', 'كافيهات', 'للتصوير'], trend: true, addedAt: '2026-08-10', desc: 'الحي المالي بعمارة مستقبلية وكافيهات جديدة.', verified: false },
  { id: 'diplomatic-quarter', name: 'الحي الدبلوماسي', nameEn: 'Diplomatic Quarter', sec: 'destination', sub: 'nature', audience: 'family', district: 'west', area: 'السفارات', price: 2, tags: ['حدائق', 'مشي', 'هدوء'], trend: false, addedAt: '2026-05-01', desc: 'أهدأ منطقة في الرياض: حدائق وممشى وكافيهات.', verified: false },
  { id: 'masmak', name: 'قصر المصمك', nameEn: 'Al Masmak Fortress', sec: 'destination', sub: 'heritage', audience: 'all', district: 'center', area: 'الديرة', price: 1, tags: ['تراث', 'مجاني'], trend: false, addedAt: '2026-05-01', desc: 'قلب الرياض القديمة — القصر التاريخي والأسواق حوله.', verified: false },
  { id: 'national-museum', name: 'المتحف الوطني', nameEn: 'National Museum of Saudi Arabia', sec: 'destination', sub: 'heritage', audience: 'family', district: 'center', area: 'المربع', price: 1, tags: ['متحف', 'سياح'], trend: false, addedAt: '2026-05-01', desc: 'أكبر متحف في السعودية — تاريخ الجزيرة العربية.', verified: false },
  { id: 'wadi-hanifa', name: 'وادي حنيفة', nameEn: 'Wadi Hanifa', sec: 'destination', sub: 'nature', audience: 'family', district: 'west', area: 'غرب الرياض', price: 1, tags: ['طبيعة', 'مجاني'], trend: false, addedAt: '2026-05-01', desc: 'وادي طبيعي بمسارات مشي وجلسات.', verified: false },
  { id: 'edge-of-world', name: 'حافة العالم', nameEn: 'Edge of the World', sec: 'destination', sub: 'nature', audience: 'men', district: 'outside', area: '~90 كم شمال غرب', price: 1, tags: ['مغامرة', 'دفع رباعي'], trend: false, addedAt: '2026-05-01', desc: 'جرف صخري بإطلالة مذهلة — يحتاج دفع رباعي. تحقّق من حالة الطريق.', verified: false },
  { id: 'king-abdullah-park', name: 'حديقة الملك عبدالله', nameEn: 'King Abdullah Park', sec: 'destination', sub: 'nature', audience: 'family', district: 'center', area: 'الملز', price: 1, tags: ['نافورة', 'عوائل'], trend: false, addedAt: '2026-05-01', desc: 'حديقة كبيرة بنافورة راقصة.', verified: false },
  { id: 'riyadh-zoo', name: 'حديقة الحيوان', nameEn: 'Riyadh Zoo', sec: 'destination', sub: 'fun', audience: 'family', district: 'center', area: 'الملز', price: 1, tags: ['عوائل', 'أطفال'], trend: false, addedAt: '2026-05-01', desc: 'حديقة حيوان الرياض في الملز.', verified: false },
  { id: 'bounce', name: 'باونس', nameEn: 'Bounce Riyadh', sec: 'destination', sub: 'fun', audience: 'all', district: 'north', area: 'الرياض', price: 2, tags: ['ترامبولين', 'شباب'], trend: false, addedAt: '2026-05-01', desc: 'صالة ترامبولين ومغامرات.', verified: false },
  { id: 'vox-front', name: 'فوكس سينما — الرياض فرونت', nameEn: 'VOX Cinemas Riyadh Front', sec: 'destination', sub: 'cinema', audience: 'all', district: 'north', area: 'الرياض فرونت', price: 2, tags: ['سينما', 'IMAX'], trend: false, addedAt: '2026-05-01', desc: 'من أكبر صالات السينما في الرياض.', verified: false },
  { id: 'muvi', name: 'موفي سينما', nameEn: 'Muvi Cinemas', sec: 'destination', sub: 'cinema', audience: 'all', district: 'north', area: 'عدة فروع', price: 2, tags: ['سينما', 'سعودي'], trend: false, addedAt: '2026-05-01', desc: 'سلسلة سينما سعودية بفروع في المولات.', verified: false },

  // ================= أسواق =================
  { id: 'kingdom-centre', name: 'مركز المملكة', nameEn: 'Kingdom Centre', sec: 'market', sub: 'mall', audience: 'all', district: 'center', area: 'العليا', price: 3, tags: ['ماركات', 'جسر المشاهدة'], trend: false, addedAt: '2026-05-01', desc: 'برج الرياض الأيقوني: ماركات عالمية وجسر المشاهدة.', verified: false },
  { id: 'faisaliah', name: 'الفيصلية', nameEn: 'Al Faisaliah Mall', sec: 'market', sub: 'mall', audience: 'all', district: 'center', area: 'العليا', price: 3, tags: ['ماركات', 'فاخر'], trend: false, addedAt: '2026-05-01', desc: 'مول ماركات فاخرة تحت برج الفيصلية.', verified: false },
  { id: 'centria', name: 'سنتريا مول', nameEn: 'Centria Mall', sec: 'market', sub: 'mall', audience: 'all', district: 'center', area: 'العليا', price: 3, tags: ['ماركات', 'مطاعم'], trend: false, addedAt: '2026-05-01', desc: 'مول فاخر في العليا بمطاعم راقية.', verified: false },
  { id: 'riyadh-park', name: 'الرياض بارك', nameEn: 'Riyadh Park Mall', sec: 'market', sub: 'mall', audience: 'family', district: 'north', area: 'الدائري الشمالي', price: 2, tags: ['عوائل', 'سينما'], trend: false, addedAt: '2026-05-01', desc: 'مول عائلي كبير فيه سينما ومنطقة ألعاب.', verified: false },
  { id: 'nakheel-mall', name: 'النخيل مول', nameEn: 'Al Nakheel Mall', sec: 'market', sub: 'mall', audience: 'family', district: 'north', area: 'المغرزات', price: 2, tags: ['عوائل'], trend: false, addedAt: '2026-05-01', desc: 'من أكبر مولات شمال الرياض.', verified: false },
  { id: 'hayat-mall', name: 'حياة مول', nameEn: 'Hayat Mall', sec: 'market', sub: 'mall', audience: 'family', district: 'north', area: 'الرياض', price: 2, tags: ['عوائل'], trend: false, addedAt: '2026-05-01', desc: 'مول عائلي كبير.', verified: false },
  { id: 'granada-mall', name: 'غرناطة مول', nameEn: 'Granada Mall', sec: 'market', sub: 'mall', audience: 'family', district: 'east', area: 'غرناطة', price: 2, tags: ['شرق الرياض'], trend: false, addedAt: '2026-05-01', desc: 'أشهر مول في شرق الرياض.', verified: false },
  { id: 'panorama-mall', name: 'بانوراما مول', nameEn: 'Panorama Mall', sec: 'market', sub: 'mall', audience: 'family', district: 'west', area: 'طريق التخصصي', price: 2, tags: ['عوائل'], trend: false, addedAt: '2026-05-01', desc: 'مول على طريق التخصصي.', verified: false },
  { id: 'souq-al-zal', name: 'سوق الزل', nameEn: 'Souq Al Zal', sec: 'market', sub: 'souq', audience: 'all', district: 'center', area: 'الديرة', price: 1, tags: ['شعبي', 'عود', 'سجاد'], trend: false, addedAt: '2026-05-01', desc: 'أقدم سوق شعبي في الرياض — مزاد يومي.', verified: false },
  { id: 'souq-thumairi', name: 'سوق الثميري', nameEn: 'Thumairi Souq', sec: 'market', sub: 'souq', audience: 'all', district: 'center', area: 'الديرة', price: 1, tags: ['ذهب', 'تراث'], trend: false, addedAt: '2026-05-01', desc: 'سوق شعبي قرب المصمك.', verified: false },
  { id: 'outlet-demo', name: 'أوتلت (مثال — استبدله)', sec: 'market', sub: 'outlet', audience: 'all', district: 'south', area: 'الرياض', price: 1, tags: ['تخفيضات'], trend: false, addedAt: '2026-09-01', desc: 'إدخال توضيحي.', verified: false, demo: true },

  // ================= أطفال =================
  { id: 'kidzania', name: 'كيدزانيا الرياض', nameEn: 'KidZania Riyadh', sec: 'kids', sub: 'edu', audience: 'family', district: 'north', area: 'الحكير تايم', price: 2, tags: ['تعليمي', '4-14 سنة'], trend: false, addedAt: '2026-05-01', desc: 'مدينة مصغّرة يجرّب فيها الأطفال المهن.', verified: false },
  { id: 'billy-beez', name: 'بيلي بيز', nameEn: 'Billy Beez', sec: 'kids', sub: 'indoor', audience: 'family', district: 'north', area: 'الرياض بارك', price: 2, tags: ['ألعاب', 'مكيّف'], trend: false, addedAt: '2026-05-01', desc: 'منطقة ألعاب داخلية كبيرة.', verified: false },
  { id: 'sparkys', name: 'سباركيز', nameEn: "Sparky's", sec: 'kids', sub: 'indoor', audience: 'family', district: 'east', area: 'عدة فروع', price: 1, tags: ['ألعاب', 'مولات'], trend: false, addedAt: '2026-05-01', desc: 'صالات ألعاب في أغلب المولات.', verified: false },
  { id: 'snow-city', name: 'سنو سيتي', nameEn: 'Snow City', sec: 'kids', sub: 'park', audience: 'family', district: 'east', area: 'العثيم مول — الربوة', price: 2, tags: ['ثلج', 'تزلج'], trend: false, addedAt: '2026-05-01', desc: 'مدينة ثلجية داخلية.', verified: false },
  { id: 'kids-shop-demo', name: 'محل أطفال (مثال — استبدله)', sec: 'kids', sub: 'shop', audience: 'family', district: 'north', area: 'الرياض', price: 2, tags: ['ملابس', 'ألعاب'], trend: false, addedAt: '2026-09-01', desc: 'إدخال توضيحي.', verified: false, demo: true },

  // ================= شاليهات =================
  { id: 'thumamah-chalets', name: 'استراحات وشاليهات الثمامة', nameEn: 'Thumamah chalets area', sec: 'chalet', sub: 'rest', audience: 'men', district: 'north', area: 'طريق الثمامة', price: 2, tags: ['طلعات', 'حجز عبر التطبيقات'], trend: false, addedAt: '2026-05-01', desc: 'أشهر منطقة استراحات شمال الرياض — الحجز عبر تطبيقات مثل جاذرن.', verified: false },
  { id: 'chalet-kids-demo', name: 'شاليه ألعاب أطفال (مثال — استبدله)', sec: 'chalet', sub: 'kids', audience: 'family', district: 'north', area: 'الرمال', price: 2, tags: ['ألعاب', 'مسبح', 'عوائل'], trend: true, addedAt: '2026-09-03', desc: 'إدخال توضيحي: الشاليهات التي فيها ألعاب كثيرة للأطفال.', verified: false, demo: true },
  { id: 'chalet-lux-demo', name: 'شاليه فخم (مثال — استبدله)', sec: 'chalet', sub: 'luxury', audience: 'all', district: 'north', area: 'الرياض', price: 3, tags: ['فخم', 'مسبح خاص'], trend: false, addedAt: '2026-09-03', desc: 'إدخال توضيحي: أضف رابط الحجز المباشر.', verified: false, demo: true },
  { id: 'chalet-events-demo', name: 'شاليه مناسبات (مثال — استبدله)', sec: 'chalet', sub: 'events', audience: 'all', district: 'east', area: 'الرياض', price: 3, tags: ['مناسبات', 'سعة كبيرة'], trend: false, addedAt: '2026-09-03', desc: 'إدخال توضيحي.', verified: false, demo: true },
  { id: 'farm-demo', name: 'مزرعة للإيجار (مثال — استبدله)', sec: 'chalet', sub: 'farm', audience: 'family', district: 'outside', area: 'الدرعية / العمارية', price: 2, tags: ['مزرعة', 'عوائل'], trend: false, addedAt: '2026-09-03', desc: 'إدخال توضيحي.', verified: false, demo: true },

  // ================= قاعات وأفراح =================
  { id: 'wedding-hall-demo', name: 'قاعة أفراح جديدة (مثال — استبدله)', sec: 'venue', sub: 'wedding', audience: 'all', district: 'north', area: 'الرياض', price: 3, tags: ['جديد', 'فخم'], trend: true, addedAt: '2026-09-05', desc: 'إدخال توضيحي: أضف القاعات الجديدة التي يبحث عنها الناس.', verified: false, demo: true },
  { id: 'ritz-weddings', name: 'ريتز كارلتون — قاعات المناسبات', nameEn: 'The Ritz-Carlton Riyadh Ballroom', sec: 'venue', sub: 'hotel', audience: 'all', district: 'west', area: 'الحدا', price: 3, tags: ['فندقي', 'فخم'], trend: false, addedAt: '2026-05-01', desc: 'قاعات فندقية للأفراح الكبيرة.', verified: false },
  { id: 'small-hall-demo', name: 'قاعة مناسبات صغيرة (مثال — استبدله)', sec: 'venue', sub: 'small', audience: 'all', district: 'east', area: 'الرياض', price: 2, tags: ['خطوبة', 'ميلاد'], trend: false, addedAt: '2026-09-05', desc: 'إدخال توضيحي.', verified: false, demo: true },

  // ================= فنادق =================
  { id: 'four-seasons', name: 'فورسيزونز الرياض', nameEn: 'Four Seasons Hotel Riyadh', sec: 'hotel', sub: 'luxury', audience: 'all', district: 'center', area: 'مركز المملكة', price: 3, tags: ['فاخر', 'في البرج'], trend: false, addedAt: '2026-05-01', desc: 'داخل برج المملكة.', verified: false },
  { id: 'ritz-carlton', name: 'ريتز كارلتون الرياض', nameEn: 'The Ritz-Carlton Riyadh', sec: 'hotel', sub: 'luxury', audience: 'all', district: 'west', area: 'الحدا', price: 3, tags: ['قصر', 'حدائق'], trend: false, addedAt: '2026-05-01', desc: 'فندق بطراز القصور وحدائق واسعة.', verified: false },
  { id: 'mandarin-oriental', name: 'ماندارين أورينتال الفيصلية', nameEn: 'Mandarin Oriental Al Faisaliah', sec: 'hotel', sub: 'luxury', audience: 'all', district: 'center', area: 'العليا', price: 3, tags: ['فاخر', 'وسط المدينة'], trend: false, addedAt: '2026-05-01', desc: 'فندق برج الفيصلية.', verified: false },
  { id: 'mansard', name: 'مانسارد الرياض', nameEn: 'Mansard Riyadh, Radisson Collection', sec: 'hotel', sub: 'luxury', audience: 'all', district: 'north', area: 'الرياض', price: 3, tags: ['فاخر', 'حديث', 'للتصوير'], trend: true, addedAt: '2026-08-01', desc: 'فندق حديث بطراز فرنسي.', verified: false },
  { id: 'fairmont-riyadh', name: 'فيرمونت الرياض', nameEn: 'Fairmont Riyadh', sec: 'hotel', sub: 'luxury', audience: 'all', district: 'east', area: 'بزنس قيت', price: 3, tags: ['قرب المطار'], trend: false, addedAt: '2026-05-01', desc: 'فندق فاخر في بزنس قيت.', verified: false },
  { id: 'narcissus', name: 'نارسيس الرياض', nameEn: 'Narcissus Hotel', sec: 'hotel', sub: 'luxury', audience: 'all', district: 'center', area: 'العليا', price: 3, tags: ['كلاسيكي'], trend: false, addedAt: '2026-05-01', desc: 'فندق فاخر بطراز كلاسيكي.', verified: false },
  { id: 'hyatt-olaya', name: 'حياة ريجنسي العليا', nameEn: 'Hyatt Regency Riyadh Olaya', sec: 'hotel', sub: 'mid', audience: 'all', district: 'center', area: 'العليا', price: 2, tags: ['أعمال', 'وسط المدينة'], trend: false, addedAt: '2026-05-01', desc: 'فندق أعمال في قلب العليا.', verified: false },
  { id: 'hilton-riyadh', name: 'هيلتون الرياض', nameEn: 'Hilton Riyadh Hotel & Residences', sec: 'hotel', sub: 'mid', audience: 'family', district: 'east', area: 'الدائري الشرقي', price: 2, tags: ['عوائل', 'مسبح'], trend: false, addedAt: '2026-05-01', desc: 'فندق كبير شرق الرياض.', verified: false },
  { id: 'crowne-rdc', name: 'كراون بلازا RDC', nameEn: 'Crowne Plaza Riyadh RDC', sec: 'hotel', sub: 'mid', audience: 'all', district: 'north', area: 'الرياض', price: 2, tags: ['أعمال'], trend: false, addedAt: '2026-05-01', desc: 'فندق أعمال ومؤتمرات.', verified: false },
  { id: 'apart-demo', name: 'شقق فندقية (مثال — استبدله)', sec: 'hotel', sub: 'apart', audience: 'family', district: 'north', area: 'الرياض', price: 2, tags: ['عوائل', 'إقامة طويلة'], trend: false, addedAt: '2026-09-01', desc: 'إدخال توضيحي.', verified: false, demo: true },
  { id: 'nofa', name: 'منتجع نوفا', nameEn: 'Nofa Resort Riyadh', sec: 'hotel', sub: 'resort', audience: 'family', district: 'outside', area: '~90 كم عن الرياض', price: 3, tags: ['منتجع', 'سفاري', 'خيول'], trend: false, addedAt: '2026-05-01', desc: 'منتجع خارج الرياض بحديقة سفاري وخيول.', verified: false },

  // ================= فعاليات =================
  { id: 'riyadh-season', name: 'موسم الرياض', nameEn: 'Riyadh Season', sec: 'event', sub: 'season', audience: 'family', district: 'north', area: 'مناطق متعددة', price: 2, tags: ['موسمي', 'الأكبر'], trend: true, addedAt: '2026-09-01', desc: 'أكبر موسم ترفيهي في المنطقة — تحقّق من تواريخ الموسم الحالي.', ig: 'riyadhseason', verified: false },
  { id: 'noor-riyadh', name: 'نور الرياض', nameEn: 'Noor Riyadh', sec: 'event', sub: 'season', audience: 'all', district: 'center', area: 'مواقع متعددة', price: 1, tags: ['فن الضوء', 'مجاني', 'للتصوير'], trend: false, addedAt: '2026-05-01', desc: 'مهرجان فن الضوء السنوي — أعمال ضوئية في أنحاء المدينة. تحقّق من التواريخ.', verified: false },
  { id: 'soundstorm', name: 'ساوند ستورم', nameEn: 'MDLBEAST Soundstorm', sec: 'event', sub: 'concert', audience: 'men', district: 'outside', area: 'بنبان', price: 3, tags: ['حفلات', 'ديسمبر'], trend: false, addedAt: '2026-05-01', desc: 'أكبر مهرجان موسيقي في المنطقة — عادةً في ديسمبر.', verified: false },
  { id: 'book-fair', name: 'معرض الرياض الدولي للكتاب', nameEn: 'Riyadh International Book Fair', sec: 'event', sub: 'expo', audience: 'family', district: 'north', area: 'الرياض', price: 1, tags: ['كتب', 'سنوي'], trend: false, addedAt: '2026-05-01', desc: 'أكبر معرض كتاب في المنطقة — سنوي. تحقّق من التواريخ.', verified: false },
  { id: 'event-week-demo', name: 'فعالية هذا الأسبوع (مثال — استبدله)', sec: 'event', sub: 'week', audience: 'all', district: 'center', area: 'الرياض', price: 1, tags: ['مؤقت'], trend: true, addedAt: '2026-09-10', endsAt: '2026-12-31', desc: 'إدخال توضيحي: الفعاليات لها تاريخ انتهاء (endsAt) وتختفي بعده تلقائيًا.', verified: false, demo: true },

  // ================= مثال مكان مدفوع =================
  { id: 'sponsored-demo', name: 'مطعم شريك (مثال — استبدله)', sec: 'restaurant', sub: 'grill', audience: 'family', district: 'north', area: 'الرياض', price: 2, tags: ['مشاوي', 'عوائل'], trend: false, sponsored: true, addedAt: '2026-09-01', desc: 'إدخال توضيحي لمكان مدفوع: يظهر بشارة "إعلان" في قسم "أماكن مميزة" ولا يدخل الترند أبدًا.', verified: false, demo: true },
];
