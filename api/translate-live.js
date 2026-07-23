// RAFD Live Interpreter — real-time speech translation for the /translator page.
// Receives raw speech-recognition text (may contain mis-heard words) and returns
// a clean spoken-style translation. Same env var convention as chat-khalid.js:
// if ANTHROPIC_API_KEY is missing the endpoint reports it instead of failing silently.

const TARGETS = {
  ar: 'Arabic',
  en: 'English'
};

function buildSystemPrompt(target, style) {
  const targetName = TARGETS[target] || 'Arabic';
  const dialectRule = target === 'ar' && style === 'saudi'
    ? 'Translate into natural spoken Saudi Arabic (اللهجة السعودية البيضاء) — the way a Saudi interpreter would say it out loud, warm and natural, not stiff Modern Standard Arabic.'
    : `Translate into clear, natural ${targetName}${target === 'ar' ? ' (فصحى مبسطة سلسة مناسبة للنطق الصوتي)' : ''}.`;

  return `You are a professional simultaneous interpreter working live at an event. You receive one segment at a time of raw automatic speech-recognition output, plus the few segments that came before it for context.

Rules:
- ${dialectRule}
- The input comes from speech recognition and may contain mis-heard or garbled words. Use the context to silently correct them to the closest plausible word the speaker most likely said (e.g. "machine lurning" → "machine learning"). Never translate a recognition error literally.
- Keep technical terms that are normally said in English (AI, API, deep learning...) in English inside the translation when that is how people actually say them.
- The translation will be read aloud by text-to-speech: short natural sentences, no abbreviations that sound wrong when spoken, no markdown, no quotes.
- Output ONLY the translation of the CURRENT segment. No explanations, no notes, no repetition of the source text.
- If the segment is pure noise or has no translatable content, output exactly: ...`;
}

module.exports = async (req, res) => {
  const _ORIGIN = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', _ORIGIN);
  if (_ORIGIN !== '*') res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(200).json({ error: 'no_key' });
  }

  try {
    const { text, target = 'ar', style = 'fusha', recent = [] } = req.body || {};
    if (!text || !String(text).trim()) return res.status(400).json({ error: 'missing text' });

    const segment = String(text).slice(0, 1200);
    const context = (Array.isArray(recent) ? recent : [])
      .slice(-4)
      .map(s => String(s).slice(0, 400));

    const userContent = (context.length
      ? `Previous segments (context only, already translated — do NOT retranslate):\n${context.map(s => `- ${s}`).join('\n')}\n\n`
      : '') + `Current segment to translate:\n${segment}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        temperature: 0.2,
        system: buildSystemPrompt(target, style),
        messages: [{ role: 'user', content: userContent }]
      })
    });

    if (!response.ok) throw new Error(`Anthropic ${response.status}`);
    const data = await response.json();
    const translation = (data.content?.[0]?.text || '').trim();
    if (!translation || translation === '...') {
      return res.status(200).json({ translation: '', skipped: true });
    }

    return res.status(200).json({ translation });
  } catch (err) {
    console.error('translate-live error:', err);
    return res.status(200).json({ error: 'translate_failed' });
  }
};
