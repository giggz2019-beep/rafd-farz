// RAFD — AI Engineer practical assessment evaluator.
//
// Actions:
//   submit    → candidate finished: store in assessment_submissions + email (both best-effort)
//   evaluate  → grades a submission with Claude; persists the report when submission_id given
//   inbox     → employer (ADMIN_PASSWORD): list stored submissions, newest first
//   delete_submission → employer (ADMIN_PASSWORD): remove one row
//   notify    → legacy email-only path, kept for older cached pages
//
// Storage is the assessment_submissions table (supabase-assessment.sql). If the
// table or SUPABASE_SERVICE_KEY is missing, submit degrades to email + the
// on-screen RAFD1 code, and inbox reports that it is not set up.
//
// This lives in _lib rather than being its own api/*.js route because the Hobby
// plan caps a deployment at 12 Serverless Functions and api/ is already at 12.
// Files under _lib are not counted, so api/read-document.js dispatches here when
// the request body carries an assessment action, and vercel.json rewrites
// /api/assess-candidate onto it so the frontend keeps a route of its own.
//
// Env vars (both optional — the feature degrades instead of breaking):
//   ANTHROPIC_API_KEY  missing → { manual: true }, dashboard falls back to manual scoring
//   RESEND_API_KEY     missing → notify is a no-op, candidate still gets a submission code
//   ASSESSMENT_EMAIL   where submissions are mailed (default info@rafd-digital.com)

const { rateLimit, getIp } = require('./rate-limit');

// Same Supabase project already used by admin-data.js / chat-khalid.js.
const SUPABASE_URL = 'https://ycnnawohrbbluawxzttt.supabase.co';
const TABLE = 'assessment_submissions';

const MODEL = 'claude-opus-5';

// Effort is the main latency lever, and the whole call has to finish inside the
// host function's maxDuration (currently the plan default — no `functions` entry
// in vercel.json, because a bad value there fails the deployment outright).
// Opus 5 grades well below its ceiling, so 'medium' buys latency headroom cheaply.
// Raise to 'high' only alongside a verified maxDuration increase.
const EFFORT = 'medium';

const RUBRIC = [
  { key: 'ai_llm', max: 20, label: 'AI & LLM Engineering' },
  { key: 'rag', max: 15, label: 'RAG & Knowledge Retrieval' },
  { key: 'backend_api', max: 15, label: 'Backend / API Integration' },
  { key: 'architecture', max: 15, label: 'System Architecture' },
  { key: 'security', max: 10, label: 'Security & Data Protection' },
  { key: 'production', max: 10, label: 'Production / Deployment' },
  { key: 'problem_solving', max: 10, label: 'Problem Solving' },
  { key: 'communication', max: 5, label: 'Communication & Clarity' }
];

const SYSTEM_PROMPT = `You are a principal AI engineer evaluating a candidate's 30-minute practical assessment for RAFD, a Saudi AI and automation company. The hiring manager is NOT technical — your report is their only window into this candidate's real ability.

The candidate was asked to design an intelligent customer-service agent for a retail client (product catalog, prices, stock, FAQ/policies, orders, WhatsApp channel) that answers from a knowledge base, calls an order-status API, avoids hallucinating, escalates when unsure, keeps conversation context, and can be deployed securely.

━━━━ SCORING (total 100) ━━━━
AI & LLM Engineering 20 | RAG & Knowledge Retrieval 15 | Backend / API Integration 15 | System Architecture 15 | Security & Data Protection 10 | Production / Deployment 10 | Problem Solving 10 | Communication & Clarity 5

━━━━ HOW TO SCORE ━━━━
Award points for demonstrated UNDERSTANDING, never for mentioning technology names. Naming a tool is worth zero on its own.

RAG — Weak: "Use LangChain and a vector database." Strong: explains ingestion, chunking strategy, embeddings, retrieval, metadata filtering, how context is assembled for the prompt, what happens at low confidence, and how retrieval quality is measured.

Security — Weak: "Use authentication." Strong: explains authentication vs authorization, tenant isolation, scoping the order lookup to the authenticated customer, API permissions, secrets management, input validation, and how one client's data is prevented from reaching another.

Architecture — Weak: a list of technologies. Strong: explains how components communicate, what data flows where, and why each component is needed.

AI agents — assess whether the candidate distinguishes LLM response generation, retrieval, tools/functions, orchestration, memory, and business rules. Conflating these is a significant gap.

━━━━ FAIRNESS RULES (binding) ━━━━
- Never deduct for tool choice. AWS vs Azure, PostgreSQL vs another suitable database, LangGraph vs another orchestrator, Pinecone vs pgvector, OpenAI vs another capable model — all equally acceptable. Judge only whether the chosen architecture is technically sound.
- This was a 30-minute written exercise. Do NOT penalise for the absence of a deployed application, a repository link, or working code. The optional prototype section is a bonus only; its absence is never a negative.
- Judge engineering reasoning and depth, not English fluency, spelling, typing speed, or answer length. A short precise answer outscores a long vague one.
- Do not reward confident-sounding prose that contains no specifics.

━━━━ CALIBRATION ━━━━
90-100 senior, would independently own this build | 80-89 strong, ready with light guidance | 70-79 solid, needs supervision | 60-69 developing, notable gaps | below 60 does not yet meet the bar.
Be honest and discriminating. Most real candidates land between 45 and 80. Do not inflate. An empty or near-empty section scores at or near zero for its category — say so plainly rather than inferring intent.

━━━━ REPORT LANGUAGE ━━━━
Every piece of prose you output (strengths, weaknesses, risks, notes, summary, flags) must be in ARABIC, written for a non-technical reader: plain language, concrete, no jargon left unexplained. Keep English technical terms only where no natural Arabic equivalent exists (RAG, API, embeddings), and explain them in the same sentence the first time.

Be specific and evidence-based. Quote or paraphrase what the candidate actually wrote rather than describing them in the abstract. Where a section is empty, say it is empty. Never invent content the candidate did not write.`;

const RATING_ENUM = ['ممتاز', 'قوي', 'متوسط', 'ضعيف', 'غير كافٍ'];

function levelBlock(description) {
  return {
    type: 'object',
    description,
    properties: {
      rating: { type: 'string', enum: RATING_ENUM },
      note: { type: 'string', description: 'جملة أو جملتان بالعربية تشرح سبب هذا التقييم بلغة يفهمها غير التقني.' }
    },
    required: ['rating', 'note'],
    additionalProperties: false
  };
}

const scoreProps = {};
for (const r of RUBRIC) {
  scoreProps[r.key] = {
    type: 'integer',
    description: `${r.label} — من 0 إلى ${r.max}.`
  };
}

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    scores: {
      type: 'object',
      properties: scoreProps,
      required: RUBRIC.map(r => r.key),
      additionalProperties: false
    },
    score_reasons: {
      type: 'object',
      description: 'سبب مختصر بالعربية لكل درجة — لماذا هذه الدرجة تحديداً وليست أعلى.',
      properties: Object.fromEntries(RUBRIC.map(r => [r.key, { type: 'string' }])),
      required: RUBRIC.map(r => r.key),
      additionalProperties: false
    },
    strengths: {
      type: 'array',
      description: 'نقاط القوة الحقيقية المدعومة بما كتبه المرشح فعلاً. اتركها فارغة إذا لم توجد.',
      items: { type: 'string' }
    },
    weaknesses: {
      type: 'array',
      description: 'نقاط الضعف والفجوات المعرفية.',
      items: { type: 'string' }
    },
    risks: {
      type: 'array',
      description: 'المخاطر التقنية على رفد إذا تم توظيف هذا المرشح — ما الذي قد يكسر في مشروع حقيقي.',
      items: { type: 'string' }
    },
    levels: {
      type: 'object',
      properties: {
        ai: levelBlock('مستوى الذكاء الاصطناعي و LLM'),
        coding: levelBlock('مستوى البرمجة'),
        backend: levelBlock('مستوى Backend و APIs'),
        architecture: levelBlock('مستوى تصميم الأنظمة'),
        security: levelBlock('مستوى الأمان وحماية البيانات'),
        production: levelBlock('الجاهزية للتشغيل الفعلي Production')
      },
      required: ['ai', 'coding', 'backend', 'architecture', 'security', 'production'],
      additionalProperties: false
    },
    can_deliver: {
      type: 'string',
      description: 'هل يستطيع هذا المرشح استلام مشروع حقيقي من رفد وتنفيذه من المتطلبات حتى Production؟',
      enum: ['نعم، بشكل مستقل', 'نعم، مع إشراف محدود', 'يحتاج إشراف مستمر', 'لا']
    },
    can_deliver_reason: { type: 'string', description: 'سببان أو ثلاثة بالعربية.' },
    recommendation: {
      type: 'string',
      enum: ['توظيف بقوة', 'مناسب للتوظيف', 'مناسب بشرط', 'لا يوصى بالتوظيف']
    },
    recommendation_reason: { type: 'string', description: 'خلاصة القرار بالعربية في ثلاث جمل كحد أقصى.' },
    interview_questions: {
      type: 'array',
      description: 'ثلاثة إلى خمسة أسئلة محددة يطرحها صاحب العمل في المقابلة للتحقق من الفجوات التي ظهرت. بالعربية، وكل سؤال مفهوم لغير التقني.',
      items: { type: 'string' }
    },
    flags: {
      type: 'array',
      description: 'ملاحظات تحذيرية: أقسام فارغة، إجابات عامة بلا تفاصيل، تناقضات، أو مؤشرات على نسخ ولصق.',
      items: { type: 'string' }
    },
    summary: { type: 'string', description: 'ملخص تنفيذي بالعربية في ٣-٥ جمل يقرأه صاحب العمل أولاً.' }
  },
  required: [
    'scores', 'score_reasons', 'strengths', 'weaknesses', 'risks', 'levels',
    'can_deliver', 'can_deliver_reason', 'recommendation', 'recommendation_reason',
    'interview_questions', 'flags', 'summary'
  ],
  additionalProperties: false
};

// Knowledge-check answer key. Server-side ONLY — never shipped to the page, so
// a candidate reading the page source finds nothing.
const MCQ_KEY = {
  mcq_q1: 'B', mcq_q2: 'C', mcq_q3: 'A', mcq_q4: 'D', mcq_q5: 'B',
  mcq_q6: 'A', mcq_q7: 'C', mcq_q8: 'B', mcq_q9: 'A', mcq_q10: 'D'
};

const MCQ_TOPICS = {
  mcq_q1: 'RAG purpose', mcq_q2: 'Embeddings', mcq_q3: 'Hallucination',
  mcq_q4: 'Tool calling', mcq_q5: 'HTTP 401', mcq_q6: 'Idempotency',
  mcq_q7: 'Binary search complexity', mcq_q8: 'Database index',
  mcq_q9: 'Containers vs VMs', mcq_q10: 'Secrets handling'
};

function gradeMcq(answers) {
  let score = 0, answered = 0;
  const wrong = [];
  for (const [q, key] of Object.entries(MCQ_KEY)) {
    const got = (answers && answers[q] || '').toString().trim().toUpperCase();
    if (got) answered++;
    if (got === key) score++;
    else wrong.push(`${MCQ_TOPICS[q]} (chose ${got || 'nothing'})`);
  }
  return { score, total: Object.keys(MCQ_KEY).length, answered, wrong };
}

const SECTION_LABELS = {
  s1: 'SECTION 1 — System Architecture',
  s1_diagram: 'SECTION 1 — Architecture diagram (blocks the candidate placed)',
  s2: 'SECTION 2 — AI / RAG Design',
  s2_ingest: 'SECTION 2a — How would you ingest the client knowledge?',
  s2_retrieval: 'SECTION 2b — How would retrieval work?',
  s2_fallback: 'SECTION 2c — What happens if no reliable answer is found?',
  s2_eval: 'SECTION 2d — How would you evaluate retrieval quality?',
  s3_lang: 'SECTION 3 — Chosen language',
  s3: 'SECTION 3 — Tool / API integration code',
  s4_action: 'SECTION 4a — What should the AI agent do about the malicious request?',
  s4_access: 'SECTION 4b — Preventing unauthorized access',
  s4_secrets: 'SECTION 4c — Protecting API keys and customer data',
  s4_tenant: 'SECTION 4d — Preventing cross-client data leakage',
  s5: 'SECTION 5 — Production & Deployment',
  proto: 'OPTIONAL — Prototype / implementation notes'
};

function buildTranscript(sub) {
  const c = sub.candidate || {};
  const a = sub.answers || {};
  const mcq = gradeMcq(a);
  const lines = [
    `Candidate: ${c.name || '(not given)'}`,
    `Current job title: ${c.title || '(not given)'}`,
    `Years of experience: ${c.years || '(not given)'}`,
    `Time used: ${sub.timeUsedLabel || '(unknown)'} of 30 minutes`,
    '',
    `=== KNOWLEDGE CHECK (10 objective MCQs, graded automatically) ===`,
    `Score: ${mcq.score}/${mcq.total} (${mcq.answered} answered).`,
    mcq.wrong.length ? `Missed: ${mcq.wrong.join('; ')}.` : 'All correct.',
    'Use this as supporting evidence for breadth of fundamentals (AI, programming, engineering) — the written sections remain the primary basis for every category score.',
    '',
    '=== CANDIDATE ANSWERS (verbatim) ==='
  ];
  for (const [key, label] of Object.entries(SECTION_LABELS)) {
    const raw = (a[key] || '').toString().trim();
    lines.push('', `--- ${label} ---`, raw ? raw : '[LEFT EMPTY BY THE CANDIDATE]');
  }
  return lines.join('\n');
}

async function callAnthropic(apiKey, transcript, useFallbacks) {
  const headers = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json'
  };
  const body = {
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    output_config: {
      effort: EFFORT,
      format: { type: 'json_schema', schema: RESULT_SCHEMA }
    },
    messages: [{
      role: 'user',
      content: `Evaluate this assessment submission against the rubric and return the structured report.\n\n${transcript}`
    }]
  };

  // Opus 5 safety classifiers can decline a request; a server-side fallback recovers
  // it in the same call instead of failing. Harmless here, so it is opt-in by default.
  if (useFallbacks) {
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    body.fallbacks = 'default';
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  return res;
}

async function evaluate(submission) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { manual: true, reason: 'ANTHROPIC_API_KEY غير مضبوط — استخدم التقييم اليدوي.' };
  }

  const transcript = buildTranscript(submission);

  let res = await callAnthropic(apiKey, transcript, true);
  // If the beta fallback parameter is rejected, retry once without it rather than
  // losing the whole evaluation.
  if (res.status === 400) {
    res = await callAnthropic(apiKey, transcript, false);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('assess-candidate anthropic error:', res.status, detail.slice(0, 500));
    throw new Error(`Anthropic ${res.status}`);
  }

  const data = await res.json();

  if (data.stop_reason === 'refusal') {
    return { manual: true, reason: 'رفض النموذج تقييم هذا المحتوى — استخدم التقييم اليدوي.' };
  }

  const textBlock = (data.content || []).find(b => b.type === 'text');
  if (!textBlock) throw new Error('empty model response');

  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch (err) {
    console.error('assess-candidate parse error:', textBlock.text.slice(0, 500));
    throw new Error('unparseable model response');
  }

  // Clamp every score into its rubric range, then derive the total ourselves so the
  // headline number can never contradict the parts.
  const scores = {};
  let total = 0;
  for (const r of RUBRIC) {
    const raw = Number(parsed.scores?.[r.key]);
    const val = Number.isFinite(raw) ? Math.max(0, Math.min(r.max, Math.round(raw))) : 0;
    scores[r.key] = val;
    total += val;
  }

  const mcq = gradeMcq(submission.answers || {});
  return {
    ...parsed, scores, total,
    mcq: { score: mcq.score, total: mcq.total, answered: mcq.answered },
    model: data.model || MODEL, evaluatedAt: new Date().toISOString()
  };
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

async function notify(submission, code) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { emailed: false, reason: 'RESEND_API_KEY not set' };

  const to = process.env.ASSESSMENT_EMAIL || 'info@rafd-digital.com';
  const c = submission.candidate || {};
  const rows = Object.entries(SECTION_LABELS).map(([key, label]) => {
    const val = (submission.answers?.[key] || '').toString().trim();
    return `<h3 style="font:600 14px system-ui;color:#0f172a;margin:22px 0 6px">${escapeHtml(label)}</h3>
      <pre style="white-space:pre-wrap;font:13px ui-monospace,Menlo,monospace;color:#334155;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin:0">${escapeHtml(val || '— (left empty) —')}</pre>`;
  }).join('');

  const html = `<div style="max-width:720px;margin:0 auto;font:14px system-ui;color:#0f172a">
    <h2 style="margin:0 0 4px">RAFD — AI Engineer Assessment Submission</h2>
    <p style="color:#64748b;margin:0 0 18px">A candidate has completed the technical assessment.</p>
    <table style="border-collapse:collapse;width:100%;margin-bottom:8px">
      <tr><td style="padding:6px 0;color:#64748b;width:170px">Name</td><td style="padding:6px 0;font-weight:600">${escapeHtml(c.name)}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Email</td><td style="padding:6px 0">${escapeHtml(c.email)}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Current title</td><td style="padding:6px 0">${escapeHtml(c.title)}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Years of experience</td><td style="padding:6px 0">${escapeHtml(c.years)}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Time used</td><td style="padding:6px 0">${escapeHtml(submission.timeUsedLabel)} of 30:00</td></tr>
    </table>
    <p style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:12px;color:#065f46">
      Paste the submission code below into the review dashboard to generate the Arabic evaluation report.
    </p>
    <pre style="white-space:pre-wrap;word-break:break-all;font:11px ui-monospace,Menlo,monospace;background:#0f172a;color:#a5f3fc;border-radius:8px;padding:12px">${escapeHtml(code || '')}</pre>
    ${rows}
  </div>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'RAFD Digital <noreply@rafd-digital.com>',
        to: [to],
        subject: `Assessment submission — ${c.name || 'candidate'}`,
        html
      })
    });
    if (!res.ok) {
      console.error('assess-candidate resend error:', res.status, await res.text().catch(() => ''));
      return { emailed: false };
    }
    return { emailed: true };
  } catch (err) {
    console.error('assess-candidate notify error:', err);
    return { emailed: false };
  }
}

// ─── Storage (Supabase REST, service key bypasses the deny-all RLS) ───

function sbHeaders(serviceKey, extra) {
  return Object.assign({
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json'
  }, extra || {});
}

async function saveSubmission(submission) {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) return { saved: false, reason: 'no_service_key' };

  const c = submission.candidate || {};
  const row = {
    candidate_name: c.name ? String(c.name).slice(0, 200) : null,
    candidate_email: c.email ? String(c.email).slice(0, 200) : null,
    candidate_title: c.title ? String(c.title).slice(0, 200) : null,
    candidate_years: c.years ? String(c.years).slice(0, 20) : null,
    time_used_label: submission.timeUsedLabel ? String(submission.timeUsedLabel).slice(0, 20) : null,
    submission
  };

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}`, {
      method: 'POST',
      headers: sbHeaders(serviceKey, { Prefer: 'return=representation' }),
      body: JSON.stringify(row)
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('assessment save error:', res.status, detail.slice(0, 300));
      // 404 / PGRST205 = the table has not been created yet
      return { saved: false, reason: res.status === 404 || detail.includes('PGRST205') ? 'table_missing' : 'save_failed' };
    }
    const data = await res.json();
    return { saved: true, id: Array.isArray(data) && data[0] ? data[0].id : null };
  } catch (err) {
    console.error('assessment save error:', err);
    return { saved: false, reason: 'save_failed' };
  }
}

async function listSubmissions() {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) return { ok: false, reason: 'no_service_key' };
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${TABLE}?select=*&order=created_at.desc&limit=50`,
      { headers: sbHeaders(serviceKey) }
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('assessment list error:', res.status, detail.slice(0, 300));
      return { ok: false, reason: res.status === 404 || detail.includes('PGRST205') ? 'table_missing' : 'list_failed' };
    }
    return { ok: true, rows: await res.json() };
  } catch (err) {
    console.error('assessment list error:', err);
    return { ok: false, reason: 'list_failed' };
  }
}

async function saveReport(id, report) {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey || !id) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: sbHeaders(serviceKey, { Prefer: 'return=minimal' }),
      body: JSON.stringify({ report, status: 'evaluated', evaluated_at: new Date().toISOString() })
    });
  } catch (err) {
    console.error('assessment report save error:', err);
  }
}

async function deleteSubmission(id) {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey || !id) return { ok: false };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: sbHeaders(serviceKey)
    });
    return { ok: res.ok };
  } catch (err) {
    console.error('assessment delete error:', err);
    return { ok: false };
  }
}

// Same auth as admin-data.js: ADMIN_PASSWORD compared timing-safe.
function isAdmin(body) {
  const adminPass = process.env.ADMIN_PASSWORD;
  if (!adminPass || !body || !body.password) return false;
  const crypto = require('crypto');
  const a = crypto.createHash('sha256').update(String(body.password)).digest();
  const b = crypto.createHash('sha256').update(String(adminPass)).digest();
  return crypto.timingSafeEqual(a, b);
}

const ACTIONS = ['evaluate', 'notify', 'submit', 'inbox', 'delete_submission'];

// True when this request is an assessment call rather than a document read.
function handles(body) {
  return !!body && ACTIONS.includes(body.action);
}

async function handle(req, res) {
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  try {
    const body = req.body || {};
    const { action, submission, code } = body;

    // ── Employer actions: ADMIN_PASSWORD required, brute-force rate-limited ──
    if (action === 'inbox' || action === 'delete_submission') {
      const rl = await rateLimit(`assess-admin:${getIp(req)}`, 10, 15 * 60 * 1000);
      if (rl.limited) return res.status(429).json({ error: 'too_many_attempts' });
      if (!process.env.ADMIN_PASSWORD) return res.status(503).json({ error: 'server_not_configured' });
      if (!isAdmin(body)) return res.status(401).json({ error: 'unauthorized' });

      if (action === 'inbox') {
        const out = await listSubmissions();
        return res.status(200).json(out);
      }
      const out = await deleteSubmission(body.id);
      return res.status(200).json(out);
    }

    if (!submission || typeof submission !== 'object') {
      return res.status(400).json({ error: 'missing submission' });
    }

    // ── Candidate finished: store + email, both best-effort ──
    if (action === 'submit') {
      const rl = await rateLimit(`assess-submit:${getIp(req)}`, 10, 60 * 60 * 1000);
      if (rl.limited) return res.status(429).json({ ok: false, error: 'too_many_attempts' });
      if (JSON.stringify(submission).length > 300000) {
        return res.status(400).json({ ok: false, error: 'submission too large' });
      }
      const stored = await saveSubmission(submission);
      const mailed = await notify(submission, code);
      return res.status(200).json({ ok: true, saved: stored.saved, id: stored.id || null, emailed: !!mailed.emailed });
    }

    if (action === 'notify') {
      const out = await notify(submission, code);
      return res.status(200).json({ ok: true, ...out });
    }

    if (action === 'evaluate') {
      // Deliberately unauthenticated: the employer sits with the candidate and
      // opens the result on the same laptop right after submission. The inbox
      // (listing everyone's data) stays behind ADMIN_PASSWORD; grading one
      // submission you already hold does not.
      const rl = await rateLimit(`assess-eval:${getIp(req)}`, 10, 60 * 60 * 1000);
      if (rl.limited) return res.status(429).json({ error: 'too_many_attempts' });
      const result = await evaluate(submission);
      // Persist the report so reopening the inbox never re-pays for grading.
      if (body.submission_id && result && !result.manual) {
        await saveReport(String(body.submission_id).slice(0, 60), result);
      }
      return res.status(200).json({ ok: true, result });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (err) {
    console.error('assess-candidate error:', err);
    return res.status(200).json({
      ok: false,
      manual: true,
      error: 'تعذّر التقييم الآلي. يمكنك إدخال الدرجات يدوياً.'
    });
  }
}

module.exports = { handles, handle };
