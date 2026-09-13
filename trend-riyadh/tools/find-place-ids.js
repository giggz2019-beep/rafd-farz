#!/usr/bin/env node
// يبحث عن Place ID لكل مكان في places.js ليس له placeId، عبر Places API (New) Text Search.
// يطلب الحقل id فقط (SKU "Text Search IDs Only" — الأرخص، 10,000 طلب مجاني شهريًا حسب أسعار قوقل الحالية).
//
// الاستخدام:
//   GOOGLE_MAPS_API_KEY=xxx node trend-riyadh/tools/find-place-ids.js            # يعرض النتائج فقط
//   GOOGLE_MAPS_API_KEY=xxx node trend-riyadh/tools/find-place-ids.js --write    # يكتب placeId داخل places.js
//
// راجع النتائج قبل النشر: البحث بالاسم قد يعيد فرعًا مختلفًا أو مكانًا مشابهًا.
// الأماكن التي تحمل demo:true تُتجاهل.

const fs = require('fs');
const path = require('path');

const key = process.env.GOOGLE_MAPS_API_KEY;
if (!key) { console.error('ضع المفتاح في GOOGLE_MAPS_API_KEY'); process.exit(1); }
const write = process.argv.includes('--write');
const file = path.join(__dirname, '..', 'places.js');
let src = fs.readFileSync(file, 'utf8');

global.window = {};
require(file);
const places = window.RIYADH_PLACES;

async function search(q) {
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress' },
    body: JSON.stringify({ textQuery: q, languageCode: 'ar', regionCode: 'SA', locationBias: { circle: { center: { latitude: 24.7136, longitude: 46.6753 }, radius: 50000 } }, maxResultCount: 1 }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error && data.error.message || r.status);
  return (data.places || [])[0] || null;
}

(async () => {
  let found = 0, missing = 0;
  for (const p of places) {
    if (p.demo || p.placeId) continue;
    const q = `${p.nameEn || p.name} ${p.area && !/فروع/.test(p.area) ? p.area : ''} الرياض`.trim();
    try {
      const hit = await search(q);
      if (!hit) { missing++; console.log(`✗ ${p.id}: لا نتائج (${q})`); continue; }
      found++;
      console.log(`✓ ${p.id}: ${hit.id}  — ${hit.displayName && hit.displayName.text} | ${hit.formattedAddress}`);
      if (write) {
        // يضيف placeId بعد id: '...' في الكائن المطابق
        const re = new RegExp(`(\\{\\s*id:\\s*'${p.id}'\\s*,)`);
        if (!re.test(src)) { console.log(`   ! لم أجد الكائن ${p.id} في الملف`); continue; }
        src = src.replace(re, `$1 placeId: '${hit.id}',`);
      }
    } catch (e) { missing++; console.log(`✗ ${p.id}: ${e.message}`); }
    await new Promise(r => setTimeout(r, 120));
  }
  if (write) { fs.writeFileSync(file, src); console.log('\nتم تحديث places.js'); }
  console.log(`\nوُجد: ${found} — لم يوجد: ${missing}`);
})();
