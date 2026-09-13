// ============================================================
// دليل الرياض — قاعدة بيانات الأماكن (النسخة الأولية)
// ------------------------------------------------------------
// كل مكان = كائن واحد. لإضافة مكان جديد انسخ أي كائن وعدّله.
//
// الحقول:
//   id        معرّف فريد (حروف إنجليزية وأرقام وشرطات فقط)
//   name      الاسم بالعربي
//   nameEn    الاسم بالإنجليزي (اختياري — يساعد في البحث)
//   cat       التصنيف: cafe | restaurant | sweets | destination | men | women
//                       | salon | kids | market | chalet | hotel | event
//   district  المنطقة: north | center | east | west | south | outside
//   area      الحي أو الشارع (نص حر)
//   price     1 = اقتصادي، 2 = متوسط، 3 = فاخر
//   tags      وسوم حرّة تظهر على البطاقة (مثل: عوائل، إطلالة، للتصوير)
//   trend     true إذا كان المكان "ترند الآن" — يظهر في الشريط العلوي
//   addedAt   تاريخ الإضافة YYYY-MM-DD — أي مكان أُضيف خلال 45 يوم يأخذ شارة "جديد"
//   desc      وصف قصير (سطر أو سطرين)
//   ig        حساب انستقرام بدون @ (اختياري)
//   maps      نص البحث في خرائط قوقل (اختياري — الافتراضي: الاسم + الرياض)
//   verified  true فقط بعد زيارة المكان أو التأكد من بياناته (العنوان/الافتتاح)
//   demo      true = بيانات توضيحية يجب استبدالها قبل النشر
//
// ⚠️ كل الإدخالات أدناه verified:false — أسماء أماكن معروفة في الرياض لكن
//    تفاصيلها (الحي، الأسعار، الاستمرار في العمل) تحتاج تحقّق ميداني قبل النشر.
// ============================================================

window.RIYADH_CATEGORIES = [
  { id: 'all',         label: 'الكل',           icon: '✨' },
  { id: 'cafe',        label: 'كافيهات',        icon: '☕' },
  { id: 'restaurant',  label: 'مطاعم',          icon: '🍽️' },
  { id: 'sweets',      label: 'حلويات',         icon: '🍰' },
  { id: 'destination', label: 'وجهات وسكويرات', icon: '🎡' },
  { id: 'market',      label: 'أسواق ومولات',   icon: '🛍️' },
  { id: 'men',         label: 'محلات شباب',     icon: '🧢' },
  { id: 'women',       label: 'محلات بنات',     icon: '👗' },
  { id: 'salon',       label: 'صالونات',        icon: '💇' },
  { id: 'kids',        label: 'أطفال',          icon: '🧸' },
  { id: 'chalet',      label: 'شاليهات واستراحات', icon: '🏡' },
  { id: 'hotel',       label: 'فنادق',          icon: '🏨' },
  { id: 'event',       label: 'فعاليات',        icon: '🎉' },
];

window.RIYADH_DISTRICTS = [
  { id: 'all',     label: 'كل الرياض' },
  { id: 'north',   label: 'شمال' },
  { id: 'center',  label: 'وسط' },
  { id: 'east',    label: 'شرق' },
  { id: 'west',    label: 'غرب' },
  { id: 'south',   label: 'جنوب' },
  { id: 'outside', label: 'خارج المدينة' },
];

window.RIYADH_PLACES = [
  // ---------- وجهات وسكويرات ----------
  { id: 'boulevard-city', name: 'بوليفارد رياض سيتي', nameEn: 'Boulevard Riyadh City', cat: 'destination', district: 'north', area: 'حطين', price: 2, tags: ['عوائل', 'ليلي', 'مطاعم', 'فعاليات'], trend: true, addedAt: '2026-08-20', desc: 'أكبر وجهة ترفيه في الرياض: مطاعم عالمية، مسارح، فعاليات موسم الرياض، ونافورات وعروض ليلية.', ig: 'boulevardcity', verified: false },
  { id: 'boulevard-world', name: 'بوليفارد وورلد', nameEn: 'Boulevard World', cat: 'destination', district: 'north', area: 'قرب بوليفارد سيتي', price: 2, tags: ['موسمي', 'دول العالم', 'عوائل'], trend: true, addedAt: '2026-08-20', desc: 'مناطق مستوحاة من دول مختلفة حول بحيرة اصطناعية — يفتح خلال موسم الرياض.', verified: false },
  { id: 'via-riyadh', name: 'فيا رياض', nameEn: 'VIA Riyadh', cat: 'destination', district: 'north', area: 'حطين', price: 3, tags: ['فاخر', 'مطاعم عالمية', 'سينما'], trend: true, addedAt: '2026-07-01', desc: 'وجهة فاخرة تجمع مطاعم عالمية وبوتيكات وسينما بتصميم معماري مميز.', ig: 'viariyadh', verified: false },
  { id: 'u-walk', name: 'يو ووك', nameEn: 'U Walk', cat: 'destination', district: 'north', area: 'طريق أنس بن مالك', price: 2, tags: ['ممشى', 'كافيهات', 'شباب'], trend: false, addedAt: '2026-06-15', desc: 'ممشى مفتوح فيه كافيهات ومطاعم ومحلات — مناسب للمشي والقعدة المسائية.', verified: false },
  { id: 'riyadh-front', name: 'الرياض فرونت', nameEn: 'Riyadh Front', cat: 'destination', district: 'north', area: 'طريق المطار', price: 2, tags: ['مطاعم', 'مفتوح', 'عوائل'], trend: false, addedAt: '2026-06-15', desc: 'منطقة مطاعم وكافيهات مفتوحة قرب طريق المطار، فيها مساحات مشي وفعاليات موسمية.', verified: false },
  { id: 'the-zone', name: 'ذا زون', nameEn: 'The Zone', cat: 'destination', district: 'north', area: 'شمال الرياض', price: 2, tags: ['مطاعم', 'مفتوح', 'شباب'], trend: false, addedAt: '2026-06-15', desc: 'ساحة مفتوحة تجمع مطاعم وكافيهات عصرية — مكان شبابي مسائي.', verified: false },
  { id: 'bujairi', name: 'حي البجيري — الدرعية', nameEn: 'Bujairi Terrace', cat: 'destination', district: 'west', area: 'الدرعية', price: 3, tags: ['تراث', 'مطاعم فاخرة', 'إطلالة', 'للتصوير'], trend: true, addedAt: '2026-08-01', desc: 'مطاعم عالمية بإطلالة على حي الطريف التاريخي (يونسكو) — من أجمل الأماكن للتصوير مساءً.', ig: 'bujairi', verified: false },
  { id: 'kafd', name: 'مركز الملك عبدالله المالي (كافد)', nameEn: 'KAFD', cat: 'destination', district: 'north', area: 'العقيق', price: 3, tags: ['عمارة حديثة', 'كافيهات', 'للتصوير'], trend: true, addedAt: '2026-08-10', desc: 'حي مالي بعمارة مستقبلية، فيه كافيهات ومطاعم جديدة تفتح باستمرار.', verified: false },
  { id: 'diplomatic-quarter', name: 'الحي الدبلوماسي', nameEn: 'Diplomatic Quarter', cat: 'destination', district: 'west', area: 'السفارات', price: 2, tags: ['حدائق', 'مشي', 'هدوء', 'كافيهات'], trend: false, addedAt: '2026-05-01', desc: 'أهدأ منطقة في الرياض: حدائق، ممشى، وكافيهات — مناسب للصباح.', verified: false },
  { id: 'masmak', name: 'قصر المصمك والديرة', nameEn: 'Al Masmak Fortress', cat: 'destination', district: 'center', area: 'الديرة', price: 1, tags: ['تراث', 'مجاني', 'سياح'], trend: false, addedAt: '2026-05-01', desc: 'قلب الرياض القديمة: القصر التاريخي، ساحة الصفاة، والأسواق الشعبية حولها.', verified: false },
  { id: 'wadi-hanifa', name: 'وادي حنيفة', nameEn: 'Wadi Hanifa', cat: 'destination', district: 'west', area: 'غرب الرياض', price: 1, tags: ['طبيعة', 'مشي', 'مجاني', 'عوائل'], trend: false, addedAt: '2026-05-01', desc: 'وادي طبيعي ممتد بمسارات مشي وجلسات — مناسب للطلعات في الجو المعتدل.', verified: false },
  { id: 'edge-of-world', name: 'حافة العالم', nameEn: 'Edge of the World', cat: 'destination', district: 'outside', area: 'شمال غرب الرياض (~90 كم)', price: 1, tags: ['طبيعة', 'مغامرة', 'دفع رباعي', 'للتصوير'], trend: false, addedAt: '2026-05-01', desc: 'جرف صخري بإطلالة مذهلة — يحتاج سيارة دفع رباعي وتخطيط للطلعة. تحقّق من حالة الطريق قبل الذهاب.', verified: false },
  { id: 'king-abdullah-park', name: 'حديقة الملك عبدالله', nameEn: 'King Abdullah Park', cat: 'destination', district: 'center', area: 'الملز', price: 1, tags: ['عوائل', 'نافورة', 'مشي'], trend: false, addedAt: '2026-05-01', desc: 'حديقة كبيرة في الملز بنافورة راقصة ومساحات خضراء.', verified: false },

  // ---------- كافيهات ----------
  { id: 'elixir-bunn', name: 'إلكسر بن', nameEn: 'Elixir Bunn', cat: 'cafe', district: 'north', area: 'عدة فروع', price: 2, tags: ['قهوة مختصة', 'شباب'], trend: false, addedAt: '2026-06-01', desc: 'من أوائل كافيهات القهوة المختصة في الرياض — أكثر من فرع.', ig: 'elixirbunn', verified: false },
  { id: 'half-million', name: 'هاف مليون', nameEn: 'Half Million', cat: 'cafe', district: 'north', area: 'عدة فروع', price: 2, tags: ['قهوة مختصة', 'تصميم', 'للتصوير'], trend: true, addedAt: '2026-08-15', desc: 'كافيه سعودي بتصميم مميز، مشهور بين الشباب والبنات.', ig: 'halfmillion', verified: false },
  { id: 'camel-step', name: 'خطوة جمل', nameEn: 'Camel Step', cat: 'cafe', district: 'north', area: 'عدة فروع', price: 2, tags: ['محمصة', 'قهوة مختصة'], trend: false, addedAt: '2026-06-01', desc: 'محمصة سعودية معروفة — قهوة مختصة وبيع حبوب.', ig: 'camelstep', verified: false },
  { id: 'dose-cafe', name: 'دوز كافيه', nameEn: 'Dose Cafe', cat: 'cafe', district: 'north', area: 'عدة فروع', price: 2, tags: ['قهوة مختصة', 'حلويات'], trend: false, addedAt: '2026-06-01', desc: 'سلسلة كافيهات سعودية بفروع كثيرة في الرياض.', ig: 'dose_cafe', verified: false },
  { id: 'draft-cafe', name: 'درافت كافيه', nameEn: 'Draft Cafe', cat: 'cafe', district: 'north', area: 'شمال الرياض', price: 2, tags: ['جلسات خارجية', 'شباب'], trend: false, addedAt: '2026-06-01', desc: 'كافيه بجلسات خارجية مناسب للسهرات في الجو المعتدل.', verified: false },
  { id: 'brew92', name: 'برو ٩٢', nameEn: 'Brew92', cat: 'cafe', district: 'north', area: 'عدة فروع', price: 2, tags: ['قهوة مختصة'], trend: false, addedAt: '2026-06-01', desc: 'علامة قهوة مختصة سعودية بفروع في الرياض.', ig: 'brew92', verified: false },

  // ---------- مطاعم ----------
  { id: 'najd-village', name: 'قرية نجد التراثية', nameEn: 'Najd Village', cat: 'restaurant', district: 'north', area: 'عدة فروع', price: 2, tags: ['أكل سعودي', 'عوائل', 'سياح', 'تراث'], trend: false, addedAt: '2026-05-01', desc: 'أشهر مطعم أكل شعبي نجدي بجلسات تراثية — لازم للزوار.', ig: 'najdvillage', verified: false },
  { id: 'lpm-riyadh', name: 'إل بي إم', nameEn: 'LPM Riyadh', cat: 'restaurant', district: 'north', area: 'فيا رياض — حطين', price: 3, tags: ['فرنسي', 'فاخر', 'حجز مسبق'], trend: true, addedAt: '2026-08-01', desc: 'مطعم فرنسي عالمي في فيا رياض — يحتاج حجز مسبق.', verified: false },
  { id: 'nusret', name: 'نصرت', nameEn: 'Nusr-Et Riyadh', cat: 'restaurant', district: 'center', area: 'العليا', price: 3, tags: ['ستيك', 'فاخر'], trend: false, addedAt: '2026-05-01', desc: 'فرع الرياض من سلسلة الستيك العالمية.', verified: false },
  { id: 'myazu', name: 'مايازو', nameEn: 'Myazu', cat: 'restaurant', district: 'center', area: 'العليا', price: 3, tags: ['ياباني', 'فاخر'], trend: false, addedAt: '2026-05-01', desc: 'مطعم ياباني راقي من الأسماء الثابتة في الرياض.', verified: false },
  { id: 'shawarmer', name: 'شاورمر', nameEn: 'Shawarmer', cat: 'restaurant', district: 'north', area: 'عدة فروع', price: 1, tags: ['شاورما', 'سريع', 'سعودي'], trend: false, addedAt: '2026-05-01', desc: 'سلسلة شاورما سعودية بدأت من الرياض — خيار سريع واقتصادي.', verified: false },
  { id: 'albaik', name: 'البيك', nameEn: 'Albaik', cat: 'restaurant', district: 'east', area: 'عدة فروع', price: 1, tags: ['دجاج', 'سريع', 'الأشهر'], trend: false, addedAt: '2026-05-01', desc: 'الأيقونة السعودية — فروع منتشرة في الرياض.', verified: false },
  { id: 'maestro-pizza', name: 'مايسترو بيتزا', nameEn: 'Maestro Pizza', cat: 'restaurant', district: 'north', area: 'عدة فروع', price: 1, tags: ['بيتزا', 'سعودي'], trend: false, addedAt: '2026-05-01', desc: 'سلسلة بيتزا سعودية انطلقت من الرياض.', verified: false },
  { id: 'tahlia-street', name: 'شارع التحلية (الأمير محمد بن عبدالعزيز)', nameEn: 'Tahlia Street', cat: 'restaurant', district: 'center', area: 'العليا / السليمانية', price: 2, tags: ['شارع مطاعم', 'ليلي', 'شباب'], trend: false, addedAt: '2026-05-01', desc: 'أشهر شارع مطاعم وكافيهات في الرياض — خيارات لكل الأذواق.', verified: false },

  // ---------- حلويات ----------
  { id: 'saddle', name: 'سادل', nameEn: 'Saddle', cat: 'sweets', district: 'north', area: 'شمال الرياض', price: 2, tags: ['آيسكريم', 'قهوة', 'ترند'], trend: true, addedAt: '2026-08-20', desc: 'كافيه سعودي مشهور بالآيسكريم والقهوة — طوابير في المواسم.', ig: 'saddle', verified: false },
  { id: 'bateel', name: 'بتيل', nameEn: 'Bateel', cat: 'sweets', district: 'center', area: 'عدة فروع', price: 3, tags: ['تمور فاخرة', 'هدايا', 'شوكولاتة'], trend: false, addedAt: '2026-05-01', desc: 'تمور وشوكولاتة فاخرة — أفضل هدية سعودية للزوار.', ig: 'bateel', verified: false },
  { id: 'munch-bakery', name: 'منش بيكري', nameEn: 'Munch Bakery', cat: 'sweets', district: 'north', area: 'عدة فروع', price: 2, tags: ['كيك', 'مخبوزات'], trend: false, addedAt: '2026-05-01', desc: 'مخبز سعودي مشهور بالكيك والحلويات الغربية.', ig: 'munchbakery', verified: false },
  { id: 'saadeddin', name: 'سعد الدين', nameEn: 'Saadeddin', cat: 'sweets', district: 'east', area: 'عدة فروع', price: 2, tags: ['حلويات شرقية', 'كنافة', 'عوائل'], trend: false, addedAt: '2026-05-01', desc: 'حلويات شرقية وكنافة — اسم قديم ومعروف بفروع كثيرة.', verified: false },
  { id: 'chocomelt', name: 'شوكوميلت', nameEn: 'Chocomelt', cat: 'sweets', district: 'north', area: 'عدة فروع', price: 2, tags: ['شوكولاتة', 'وافل', 'شباب'], trend: false, addedAt: '2026-05-01', desc: 'حلويات شوكولاتة ووافل — مكان مفضّل للسهرات.', verified: false },

  // ---------- أسواق ومولات ----------
  { id: 'kingdom-centre', name: 'مركز المملكة', nameEn: 'Kingdom Centre', cat: 'market', district: 'center', area: 'العليا', price: 3, tags: ['ماركات', 'جسر المشاهدة', 'معلم'], trend: false, addedAt: '2026-05-01', desc: 'برج الرياض الأيقوني: مول ماركات عالمية وجسر المشاهدة في الأعلى.', verified: false },
  { id: 'faisaliah', name: 'الفيصلية', nameEn: 'Al Faisaliah Mall', cat: 'market', district: 'center', area: 'العليا', price: 3, tags: ['ماركات', 'فاخر'], trend: false, addedAt: '2026-05-01', desc: 'مول ماركات فاخرة تحت برج الفيصلية.', verified: false },
  { id: 'riyadh-park', name: 'الرياض بارك', nameEn: 'Riyadh Park Mall', cat: 'market', district: 'north', area: 'الطريق الدائري الشمالي', price: 2, tags: ['عوائل', 'سينما', 'ترفيه'], trend: false, addedAt: '2026-05-01', desc: 'مول عائلي كبير فيه سينما ومنطقة ألعاب ومطاعم.', verified: false },
  { id: 'nakheel-mall', name: 'النخيل مول', nameEn: 'Al Nakheel Mall', cat: 'market', district: 'north', area: 'المغرزات', price: 2, tags: ['عوائل', 'ماركات'], trend: false, addedAt: '2026-05-01', desc: 'من أكبر مولات شمال الرياض.', verified: false },
  { id: 'granada-mall', name: 'غرناطة مول', nameEn: 'Granada Mall', cat: 'market', district: 'east', area: 'غرناطة', price: 2, tags: ['عوائل', 'شرق الرياض'], trend: false, addedAt: '2026-05-01', desc: 'أشهر مول في شرق الرياض.', verified: false },
  { id: 'souq-al-zal', name: 'سوق الزل', nameEn: 'Souq Al Zal', cat: 'market', district: 'center', area: 'الديرة', price: 1, tags: ['شعبي', 'عود وبخور', 'سجاد', 'سياح'], trend: false, addedAt: '2026-05-01', desc: 'أقدم سوق شعبي في الرياض: بشوت، سجاد، عود، وتحف — مزاد يومي.', verified: false },
  { id: 'souq-thumairi', name: 'سوق الثميري', nameEn: 'Thumairi Souq', cat: 'market', district: 'center', area: 'الديرة', price: 1, tags: ['شعبي', 'ذهب', 'تراث'], trend: false, addedAt: '2026-05-01', desc: 'سوق شعبي قرب المصمك: ذهب، عطور، وملابس تراثية.', verified: false },

  // ---------- محلات شباب ----------
  { id: 'lomar', name: 'لومار', nameEn: 'Lomar', cat: 'men', district: 'north', area: 'عدة فروع', price: 3, tags: ['ثياب رجالية', 'تصميم سعودي'], trend: false, addedAt: '2026-05-01', desc: 'علامة سعودية للثوب العصري — تصاميم مختلفة عن التقليدي.', ig: 'lomar', verified: false },
  { id: 'men-demo-1', name: 'محل شبابي (مثال — استبدله)', cat: 'men', district: 'north', area: 'حي الياسمين', price: 2, tags: ['سنيكرز', 'ستريت وير'], trend: true, addedAt: '2026-09-01', desc: 'إدخال توضيحي: استبدله بمحل سنيكرز أو ستريت وير فعلي ترنده الشباب حاليًا.', verified: false, demo: true },

  // ---------- محلات بنات ----------
  { id: 'rubaiyat', name: 'رباعيات', nameEn: 'Rubaiyat', cat: 'women', district: 'center', area: 'مركز المملكة', price: 3, tags: ['ماركات فاخرة', 'فساتين'], trend: false, addedAt: '2026-05-01', desc: 'بوتيك ماركات فاخرة للنساء — أسماء عالمية في مكان واحد.', verified: false },
  { id: 'abadia', name: 'عبادية', nameEn: 'Abadia', cat: 'women', district: 'north', area: 'الرياض', price: 3, tags: ['عبايات', 'تصميم سعودي'], trend: false, addedAt: '2026-05-01', desc: 'علامة سعودية لتصاميم العبايات والأزياء المعاصرة.', ig: 'abadia', verified: false },
  { id: 'women-demo-1', name: 'محل بناتي (مثال — استبدله)', cat: 'women', district: 'north', area: 'حي الملقا', price: 2, tags: ['إكسسوارات', 'ترند تيك توك'], trend: true, addedAt: '2026-09-05', desc: 'إدخال توضيحي: استبدله بمحل بنات ترند حاليًا في انستقرام/تيك توك.', verified: false, demo: true },

  // ---------- صالونات ----------
  { id: 'salon-demo-1', name: 'صالون نسائي (مثال — استبدله)', cat: 'salon', district: 'north', area: 'حي الياسمين', price: 2, tags: ['أظافر', 'شعر', 'حجز أونلاين'], trend: true, addedAt: '2026-09-01', desc: 'إدخال توضيحي: صالونات البنات تتغير بسرعة — اجمعها من حسابات انستقرام وتوصيات مباشرة.', verified: false, demo: true },
  { id: 'barber-demo-1', name: 'صالون رجالي (مثال — استبدله)', cat: 'salon', district: 'east', area: 'حي الروضة', price: 1, tags: ['حلاقة', 'شباب'], trend: false, addedAt: '2026-09-01', desc: 'إدخال توضيحي: استبدله بصالون شبابي معروف في المنطقة.', verified: false, demo: true },

  // ---------- أطفال ----------
  { id: 'kidzania', name: 'كيدزانيا الرياض', nameEn: 'KidZania Riyadh', cat: 'kids', district: 'north', area: 'الحكير تايم', price: 2, tags: ['تعليمي', '4-14 سنة', 'مغلق'], trend: false, addedAt: '2026-05-01', desc: 'مدينة مصغّرة يجرّب فيها الأطفال المهن — مناسبة ليوم كامل.', verified: false },
  { id: 'billy-beez', name: 'بيلي بيز', nameEn: 'Billy Beez', cat: 'kids', district: 'north', area: 'الرياض بارك', price: 2, tags: ['ألعاب', 'داخلي', 'مكيّف'], trend: false, addedAt: '2026-05-01', desc: 'منطقة ألعاب داخلية كبيرة للأطفال داخل المول.', verified: false },
  { id: 'sparkys', name: 'سباركيز', nameEn: "Sparky's", cat: 'kids', district: 'east', area: 'عدة فروع', price: 1, tags: ['ألعاب', 'مولات', 'اقتصادي'], trend: false, addedAt: '2026-05-01', desc: 'صالات ألعاب منتشرة في أغلب المولات.', verified: false },
  { id: 'snow-city', name: 'سنو سيتي', nameEn: 'Snow City', cat: 'kids', district: 'east', area: 'العثيم مول — الربوة', price: 2, tags: ['ثلج', 'تزلج', 'عوائل'], trend: false, addedAt: '2026-05-01', desc: 'مدينة ثلجية داخلية — تزلج وألعاب ثلج في قلب الرياض.', verified: false },

  // ---------- شاليهات واستراحات ----------
  { id: 'thumamah-chalets', name: 'استراحات وشاليهات الثمامة', nameEn: 'Thumamah chalets area', cat: 'chalet', district: 'north', area: 'طريق الثمامة', price: 2, tags: ['طلعات', 'شباب', 'عوائل', 'حجز عبر التطبيقات'], trend: false, addedAt: '2026-05-01', desc: 'أشهر منطقة استراحات وشاليهات شمال الرياض — الحجز عادة عبر تطبيقات مثل جاذرن.', verified: false },
  { id: 'chalet-demo-1', name: 'شاليه فاخر (مثال — استبدله)', cat: 'chalet', district: 'north', area: 'الرمال', price: 3, tags: ['مسبح', 'خاص', 'مناسبات'], trend: true, addedAt: '2026-09-03', desc: 'إدخال توضيحي: أضف شاليهات فعلية بروابط حجزها المباشرة (جاذرن / حساب المالك).', verified: false, demo: true },

  // ---------- فنادق ----------
  { id: 'four-seasons', name: 'فورسيزونز الرياض', nameEn: 'Four Seasons Hotel Riyadh', cat: 'hotel', district: 'center', area: 'مركز المملكة — العليا', price: 3, tags: ['فاخر', 'إطلالة', 'في البرج'], trend: false, addedAt: '2026-05-01', desc: 'داخل برج المملكة — من أشهر فنادق الرياض وأعلاها.', verified: false },
  { id: 'ritz-carlton', name: 'ريتز كارلتون الرياض', nameEn: 'The Ritz-Carlton Riyadh', cat: 'hotel', district: 'west', area: 'الحدا', price: 3, tags: ['فاخر', 'حدائق', 'قصر'], trend: false, addedAt: '2026-05-01', desc: 'فندق بطراز القصور وحدائق واسعة — وجهة للمناسبات الكبرى.', verified: false },
  { id: 'mandarin-oriental', name: 'ماندارين أورينتال الفيصلية', nameEn: 'Mandarin Oriental Al Faisaliah', cat: 'hotel', district: 'center', area: 'العليا', price: 3, tags: ['فاخر', 'مطاعم', 'وسط المدينة'], trend: false, addedAt: '2026-05-01', desc: 'فندق برج الفيصلية بموقع مركزي ومطاعم راقية.', verified: false },
  { id: 'fairmont-riyadh', name: 'فيرمونت الرياض', nameEn: 'Fairmont Riyadh', cat: 'hotel', district: 'east', area: 'بزنس قيت — طريق المطار', price: 3, tags: ['فاخر', 'قرب المطار', 'أعمال'], trend: false, addedAt: '2026-05-01', desc: 'فندق فاخر في بزنس قيت — مناسب للقادمين من المطار.', verified: false },
  { id: 'narcissus', name: 'نارسيس الرياض', nameEn: 'Narcissus Hotel', cat: 'hotel', district: 'center', area: 'العليا', price: 3, tags: ['فاخر', 'كلاسيكي'], trend: false, addedAt: '2026-05-01', desc: 'فندق فاخر بطراز كلاسيكي في قلب العليا.', verified: false },
  { id: 'hilton-riyadh', name: 'هيلتون الرياض', nameEn: 'Hilton Riyadh Hotel & Residences', cat: 'hotel', district: 'east', area: 'الطريق الدائري الشرقي', price: 2, tags: ['عوائل', 'أعمال', 'مسبح'], trend: false, addedAt: '2026-05-01', desc: 'فندق كبير شرق الرياض — خيار متوازن للعوائل ورجال الأعمال.', verified: false },

  // ---------- فعاليات ----------
  { id: 'riyadh-season', name: 'موسم الرياض', nameEn: 'Riyadh Season', cat: 'event', district: 'north', area: 'مناطق متعددة', price: 2, tags: ['موسمي', 'حفلات', 'عوائل', 'الأكبر'], trend: true, addedAt: '2026-09-01', desc: 'أكبر موسم ترفيهي في المنطقة — مناطق وحفلات وفعاليات تتجدد كل سنة. تحقّق من تواريخ الموسم الحالي.', ig: 'riyadhseason', verified: false },
  { id: 'event-demo-1', name: 'فعالية هذا الأسبوع (مثال — استبدله)', cat: 'event', district: 'center', area: 'الرياض', price: 1, tags: ['مؤقت', 'هذا الأسبوع'], trend: true, addedAt: '2026-09-10', desc: 'إدخال توضيحي: الفعاليات لها تاريخ انتهاء — أضف حقل endsAt عند تفعيل قاعدة البيانات.', verified: false, demo: true },
];
