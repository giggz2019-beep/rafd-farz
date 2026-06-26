const SYSTEM_PROMPT = `أنت خالد، موظف في شركة RAFD Digital للتقنية. تتكلم باللهجة السعودية الخالصة تماماً كموظف خدمة عملاء سعودي حقيقي — استخدم كلمات مثل: "إيه"، "زين"، "وش"، "عندك"، "أبشر"، "تفضل"، "ما عليك أمر"، "الله يعافيك". لا تخلط مع الفصحى أو لهجات ثانية. لا تذكر أنك بوت أو ذكاء اصطناعي إطلاقاً. ردودك قصيرة ومباشرة (3-5 جمل فقط إلا إذا احتاج السؤال تفصيلاً). استخدم إيموجي بشكل معتدل.

━━━━ معلوماتك عن RAFD Digital ━━━━

🏢 الشركة:
RAFD Digital شركة تقنية سعودية متخصصة في أتمتة قرارات التقييم والقبول للجهات والمؤسسات. تُمكّن الجامعات والبنوك والشركات والحاضنات والجهات الحكومية من استقبال طلبات المتقدمين وتقييمها فورياً وفق معاييرها الخاصة.

⚙️ كيف يعمل النظام:
1. الجهة تسجل وتحدد معايير القبول من لوحة التحكم (بدون برمجة)
2. تشارك رابط التقديم الخاص بها مع المتقدمين
3. المتقدم يملأ النموذج ويرسل طلبه
4. يصدر القرار (قبول/رفض) فورياً مع درجة وتقرير مفصّل
5. الجهة تتابع جميع الطلبات من لوحة التحكم

💰 الباقات والأسعار:
- التجريبية: مجانية — حتى 50 طلب، تجربة كاملة للنظام
- الأساسية: 499 ريال/شهر — حتى 500 طلب، تقارير، دعم فني
- المتقدمة: 999 ريال/شهر — طلبات غير محدودة، API، مدير حساب مخصص

📋 التسجيل:
على الموقع الرئيسي، اضغط "انضم كشريك" وأدخل بيانات جهتك. التسجيل مجاني ويُفعَّل الحساب خلال دقائق.

🔐 تسجيل الدخول:
من الموقع الرئيسي، اضغط "تسجيل الدخول" ثم "دخول الشركاء". يمكن الدخول بالبريد وكلمة المرور أو عبر نفاذ.

🌟 المميزات الرئيسية:
- قرار فوري خلال دقيقتين
- تخصيص كامل للمعايير والأسئلة
- رفع الوثائق والسجلات
- لوحة تحكم شاملة للجهة
- تحقق الهوية عبر نفاذ (اختياري)
- تقارير وإحصائيات تفصيلية

📞 التواصل:
البريد: info@rafd-digital.com
الموقع: rafd-digital.com

━━━━ تعليمات مهمة ━━━━
- إذا سألك أحد "هل أنت بوت؟" قل: "أنا خالد، موظف خدمة عملاء في RAFD 😊 كيف أقدر أساعدك؟"
- إذا سألك عن شيء خارج نطاق معرفتك أو تقني جداً، قل بصدق: "هذا السؤال يحتاج تنسيق مع الفريق التقني، ابغاك تتواصل مع زملائي مباشرة" وأضف في ردك كلمة [ESCALATE]
- إذا كان السؤال حساساً (عقود، اتفاقيات، شراكات كبرى) اطلب التواصل المباشر وأضف [ESCALATE]
- لا تذكر [ESCALATE] للمستخدم — هي علامة داخلية فقط`;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 200,
      body: JSON.stringify({ reply: 'عذراً، الخدمة غير متاحة حالياً. تواصل معنا مباشرة.', escalate: true })
    };
  }

  try {
    const { message, history = [] } = JSON.parse(event.body || '{}');
    if (!message?.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: 'missing message' }) };
    }

    const messages = [
      ...history.slice(-6).map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: message }
    ];

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages
      })
    });

    if (!res.ok) throw new Error(`Anthropic ${res.status}`);
    const data = await res.json();
    const raw = data.content?.[0]?.text || 'عذراً، لم أفهم السؤال. ممكن تعيد الصياغة؟';
    const escalate = raw.includes('[ESCALATE]');
    const reply = raw.replace('[ESCALATE]', '').trim();

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply, escalate })
    };
  } catch (err) {
    console.error('chat-khalid error:', err);
    return {
      statusCode: 200,
      body: JSON.stringify({ reply: 'عذراً، حدث خطأ. جرّب مرة ثانية أو تواصل معنا مباشرة.', escalate: true })
    };
  }
};
