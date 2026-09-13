# الصور

## `sections/` — صور أغلفة الأقسام
ملف واحد لكل قسم باسم معرّف القسم: `men.jpg`, `women.jpg`, `beauty.jpg`, `cafe.jpg`, `restaurant.jpg`, `sweets.jpg`, `destination.jpg`, `market.jpg`, `kids.jpg`, `chalet.jpg`, `venue.jpg`, `hotel.jpg`, `event.jpg`.
ثم في `places.js` أضف للقسم الحقل `image: 'img/sections/men.jpg'`. تظهر في بلاطات الرئيسية وكخلفية لبطاقات الأماكن التي ليس لها صورة خاصة.

المقاس المقترح: 1200×675 (16:9)، JPEG بجودة 80، أقل من 200 كيلوبايت.

## `places/` — صور الأماكن
ملف باسم معرّف المكان: `places/boulevard-city.jpg` ثم في `places.js`: `image: 'img/places/boulevard-city.jpg'`.

**الحقوق:** استخدم فقط صورًا تملكها، أو صورًا سلّمها لك صاحب المحل بإذن كتابي، أو صورًا مرخّصة. لا تنسخ من انستقرام أو قوقل ماب — قوقل يسمح بعرض صوره لحظيًا عبر Places API فقط (مفعّل في صفحة المكان عند وجود المفتاح) ولا يسمح بحفظها.

## `hero.jpg` — صورة الواجهة (اختياري)
إذا وُجد ملف `img/hero.jpg` ضعه في `CONFIG.heroImage` داخل `index.html` ليحل مكان رسم الأفق الافتراضي. المقاس: 1600×900.
