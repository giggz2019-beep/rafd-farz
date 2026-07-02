const PROMPTS = {
  id: `هذه صورة هوية وطنية سعودية أو إقامة. استخرج المعلومات التالية وأجب بـ JSON فقط بدون أي نص إضافي:
{"name":"الاسم الكامل","id_number":"رقم الهوية أو الإقامة","dob":"YYYY-MM-DD","gender":"male أو female","nationality":"الجنسية"}
إذا كان حقل غير واضح ضعه null.`,

  cv: `هذه سيرة ذاتية. استخرج المعلومات وأجب بـ JSON فقط:
{"name":"اسم صاحب السيرة","highest_education":"phd أو master أو bachelor أو diploma","field":"التخصص","years_experience":0,"last_position":"آخر وظيفة","skills":["مهارة"]}
إذا كان حقل غير واضح ضعه null أو مصفوفة فارغة.`,

  reg: `هذا سجل تجاري سعودي أو وثيقة تأسيس. استخرج المعلومات وأجب بـ JSON فقط:
{"company_name":"اسم الشركة","reg_number":"رقم السجل التجاري","founded_date":"YYYY أو YYYY-MM-DD","activity":"النشاط التجاري","owner":"اسم المالك أو المفوض"}
إذا كان حقل غير واضح ضعه null.`,

  cert: `هذه شهادة أو وثيقة رسمية. استخرج المعلومات وأجب بـ JSON فقط:
{"type":"نوع الشهادة أو الوثيقة","issuer":"الجهة المانحة","recipient":"اسم الحاصل","date":"YYYY أو YYYY-MM-DD"}
إذا كان حقل غير واضح ضعه null.`,
};

const DEFAULT_PROMPT = `اقرأ هذه الوثيقة واستخرج أهم المعلومات. أجب بـ JSON فقط:
{"summary":"ملخص مختصر باللغة العربية","key_info":{}}`;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(200).json({ ok: false, error: 'API key missing' });

  const { base64, mediaType, docType } = req.body || {};
  if (!base64 || !mediaType) {
    return res.status(400).json({ ok: false, error: 'Missing base64 or mediaType' });
  }

  const isImage = mediaType.startsWith('image/');
  const isPdf = mediaType === 'application/pdf';

  if (!isImage && !isPdf) {
    return res.status(200).json({ ok: false, error: 'unsupported_type' });
  }

  const prompt = PROMPTS[docType] || DEFAULT_PROMPT;

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
        max_tokens: 600,
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

    return res.status(200).json({ ok: true, data });
  } catch (err) {
    console.error('read-document error:', err.message);
    return res.status(200).json({ ok: false, error: err.message });
  }
};
