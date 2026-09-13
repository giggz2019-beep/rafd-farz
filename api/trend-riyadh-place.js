// ترند الرياض — جلب تقييم قوقل لمكان واحد لحظيًا (Places API New)
//
// GET /api/trend-riyadh-place?placeId=ChIJ...&reviews=1
//
// env: GOOGLE_MAPS_API_KEY  (مفتاح من Google Cloud مع تفعيل "Places API (New)")
//
// سياسة قوقل: يُسمح بتخزين placeId فقط. التقييم وعدد المقيّمين والمراجعات تُطلب
// حيّة عند كل عرض وتُعرض مع نسب "Google". لهذا لا نخزّن شيئًا هنا ولا في قاعدة البيانات.
//
// التكلفة (تحقّق من صفحة أسعار قوقل الحالية):
//   rating + userRatingCount  => SKU "Place Details Enterprise"            (~$35 / 1000 بعد 1000 مجانية شهريًا)
//   + reviews                  => SKU "Place Details Enterprise + Atmosphere" (~$40 / 1000)
//   + photo=1                  => طلب إضافي واحد لصورة المكان (SKU "Place Photo")
// لذلك يُطلب التقييم فقط عند فتح صفحة المكان، والمراجعات والصورة فقط إذا طُلبت.

const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,300}$/;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.status(405).json({ error: 'method_not_allowed' }); return; }

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    console.warn('[trend-riyadh-place] GOOGLE_MAPS_API_KEY not set — ratings disabled');
    res.status(200).json({ available: false, reason: 'no_api_key' });
    return;
  }

  const placeId = String(req.query.placeId || '');
  if (!PLACE_ID_RE.test(placeId)) { res.status(400).json({ error: 'bad_place_id' }); return; }
  const withReviews = req.query.reviews === '1';
  const withPhoto = req.query.photo === '1';

  const fields = ['id', 'displayName', 'rating', 'userRatingCount', 'googleMapsUri'];
  if (withReviews) fields.push('reviews');
  if (withPhoto) fields.push('photos');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=ar&regionCode=SA`, {
      headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': fields.join(',') },
      signal: ctrl.signal,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('[trend-riyadh-place] google error', r.status, data && data.error && data.error.message);
      res.status(200).json({ available: false, reason: 'google_error', status: r.status });
      return;
    }
    // صورة المكان: رابط مؤقت من قوقل يُعرض لحظيًا (لا يُخزَّن) مع نسب المصوّر
    let photo = null;
    if (withPhoto && Array.isArray(data.photos) && data.photos[0] && data.photos[0].name) {
      try {
        const ph = data.photos[0];
        const pr = await fetch(`https://places.googleapis.com/v1/${ph.name}/media?maxWidthPx=1200&skipHttpRedirect=true`, { headers: { 'X-Goog-Api-Key': key }, signal: ctrl.signal });
        const pd = await pr.json().catch(() => ({}));
        if (pr.ok && pd.photoUri) photo = { uri: pd.photoUri, author: ph.authorAttributions && ph.authorAttributions[0] ? { name: ph.authorAttributions[0].displayName || '', uri: ph.authorAttributions[0].uri || '' } : null };
      } catch (e) { console.warn('[trend-riyadh-place] photo failed', e && e.message); }
    }
    res.status(200).json({
      available: true,
      photo,
      rating: typeof data.rating === 'number' ? data.rating : null,
      userRatingCount: typeof data.userRatingCount === 'number' ? data.userRatingCount : null,
      googleMapsUri: data.googleMapsUri || null,
      // المراجعات تُعرض كما هي مع اسم الكاتب ورابطه (شرط قوقل للنسب)
      reviews: Array.isArray(data.reviews) ? data.reviews.slice(0, 5).map(v => ({
        rating: v.rating || null,
        text: (v.text && v.text.text) || (v.originalText && v.originalText.text) || '',
        relativeTime: v.relativePublishTimeDescription || '',
        author: v.authorAttribution ? { name: v.authorAttribution.displayName || '', uri: v.authorAttribution.uri || '', photo: v.authorAttribution.photoUri || '' } : null,
      })) : [],
    });
  } catch (err) {
    console.error('[trend-riyadh-place] fetch failed', err && err.message);
    res.status(200).json({ available: false, reason: err && err.name === 'AbortError' ? 'timeout' : 'network' });
  } finally {
    clearTimeout(timer);
  }
};
