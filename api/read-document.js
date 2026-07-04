// Expected detected_type per docType slot
const EXPECTED_TYPE = {
  id:   'national_id',
  cv:   'cv',
  reg:  'commercial_registration',
  cert: 'certificate',
};

// Instruction appended to every prompt so Claude always identifies the doc
const TYPE_DETECT = `
أولاً وقبل أي شيء: حدّد نوع هذه الوثيقة الفعلي بدقة وضعه في "detected_type" بأحد هذه القيم فقط:
"national_id" — هوية وطنية سعودية أو إقامة
"cv" — سيرة ذاتية (CV / Resume)
"commercial_registration" — سجل تجاري أو وثيقة تأسيس شركة
"certificate" — شهادة خبرة أو عمل أو مؤهل أكاديمي أو ما يشابهها
"other" — أي وثيقة أخرى لا تنتمي للأنواع أعلاه`;

const PROMPTS = {
  cv: `انظر إلى هذه الوثيقة.
${TYPE_DETECT}

إذا كانت سيرة ذاتية: استخرج المعلومات التالية. وإلا اترك الحقول null.
أجب بـ JSON فقط:
{"detected_type":"...","name":null,"highest_education":null,"field":null,"years_experience":null,"last_position":null,"skills":[]}`,

  reg: `انظر إلى هذه الوثيقة.
${TYPE_DETECT}

إذا كانت سجلاً تجارياً أو وثيقة تأسيس: استخرج المعلومات التالية. وإلا اترك الحقول null.
أجب بـ JSON فقط:
{"detected_type":"...","company_name":null,"reg_number":null,"founded_date":null,"activity":null,"owner":null}`,

  cert: `انظر إلى هذه الوثيقة.
${TYPE_DETECT}

إذا كانت شهادة أو وثيقة خبرة أو مؤهل: استخرج المعلومات التالية. وإلا اترك الحقول null.
أجب بـ JSON فقط:
{"detected_type":"...","type":null,"issuer":null,"recipient":null,"date":null}`,
};

const DEFAULT_PROMPT = `انظر إلى هذه الوثيقة.
${TYPE_DETECT}
استخرج أهم المعلومات. أجب بـ JSON فقط:
{"detected_type":"other","summary":"ملخص مختصر باللغة العربية"}`;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { base64, mediaType, docType, readCriteria } = req.body || {};

  // الهوية الوطنية: التحقق عبر نفاذ (SDAIA) — لا يُرسَل للذكاء الاصطناعي
  if (docType === 'id') {
    return res.status(200).json({
      ok: true,
      nafathPending: true,
      data: { detected_type: 'national_id' },
      detectedType: 'national_id',
      typeMismatch: false,
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(200).json({ ok: false, error: 'API key missing' });

  if (!base64 || !mediaType) {
    return res.status(400).json({ ok: false, error: 'Missing base64 or mediaType' });
  }

  const isImage = mediaType.startsWith('image/');
  const isPdf = mediaType === 'application/pdf';
  if (!isImage && !isPdf) {
    return res.status(200).json({ ok: false, error: 'unsupported_type' });
  }

  const hasCriteria = Array.isArray(readCriteria) && readCriteria.length > 0;

  let prompt = PROMPTS[docType] || DEFAULT_PROMPT;

  if (hasCriteria) {
    const criteriaLines = readCriteria
      .map((c, i) => `${i + 1}. "${c.prompt}"`)
      .join('\n');
    prompt += `

بالإضافة إلى ذلك، إذا كانت الوثيقة صحيحة النوع: قيّم المعايير التالية وأضفها في "criteria_results":
${criteriaLines}
لكل معيار: { "prompt": "نص المعيار", "passed": true/false, "reason": "سبب قصير" }`;
  }

  try {
    const contentBlock = isImage
      ? { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } }
      : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } };

    const headers = {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    };
    if (isPdf) headers['anthropic-beta'] = 'pdfs-2024-09-25';

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: hasCriteria ? 900 : 700,
        messages: [
          { role: 'user', content: [contentBlock, { type: 'text', text: prompt }] },
        ],
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      throw new Error(`Anthropic ${r.status}: ${errText}`);
    }

    const result = await r.json();
    const text = result.content?.[0]?.text || '';

    let data;
    try {
      const m = text.match(/\{[\s\S]*\}/);
      data = m ? JSON.parse(m[0]) : { raw: text };
    } catch {
      data = { raw: text };
    }

    // Type mismatch check
    const expectedType = EXPECTED_TYPE[docType];
    const detectedType = data.detected_type || 'other';
    const typeMismatch = expectedType && detectedType !== expectedType;

    return res.status(200).json({ ok: true, data, detectedType, typeMismatch });
  } catch (err) {
    console.error('read-document error:', err.message);
    return res.status(200).json({ ok: false, error: 'internal_error' });
  }
};
