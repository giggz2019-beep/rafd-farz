-- ============================================================
-- RAFD Digital — Row Level Security Policies
-- شغّل هذا الملف في: Supabase Dashboard > SQL Editor > New Query
-- ============================================================

-- ===== 1. partners table =====
ALTER TABLE partners ENABLE ROW LEVEL SECURITY;

-- الشريك المسجّل يقرأ بياناته فقط
CREATE POLICY "partner_select_own" ON partners
  FOR SELECT USING (
    auth.jwt() ->> 'email' = email
  );

-- الشريك يعدّل بياناته فقط
CREATE POLICY "partner_update_own" ON partners
  FOR UPDATE USING (
    auth.jwt() ->> 'email' = email
  );

-- أي شخص يقدر يسجّل شريك جديد (صفحة التسجيل)
CREATE POLICY "partner_insert_public" ON partners
  FOR INSERT WITH CHECK (true);

-- صفحة تسجيل الدخول تحتاج تبحث بالإيميل أو الرقم المرجعي
-- نسمح للـ anon يقرأ الحقول الضرورية فقط
CREATE POLICY "partner_login_lookup" ON partners
  FOR SELECT USING (true);
-- ملاحظة: هذا يسمح القراءة للكل — سنُضيّقه لاحقاً بعد مراجعة صفحة تسجيل الدخول


-- ===== 2. applications table =====
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;

-- المتقدمون (بدون حساب) يقدرون يُرسلون طلباتهم
CREATE POLICY "app_insert_public" ON applications
  FOR INSERT WITH CHECK (true);

-- الشريك يقرأ طلباته فقط
CREATE POLICY "app_select_own" ON applications
  FOR SELECT USING (
    partner_ref = (
      SELECT ref_num FROM partners
      WHERE email = auth.jwt() ->> 'email'
      LIMIT 1
    )
  );

-- الشريك يعدّل طلباته فقط (قبول/رفض)
CREATE POLICY "app_update_own" ON applications
  FOR UPDATE USING (
    partner_ref = (
      SELECT ref_num FROM partners
      WHERE email = auth.jwt() ->> 'email'
      LIMIT 1
    )
  );

-- الشريك يحذف طلباته فقط
CREATE POLICY "app_delete_own" ON applications
  FOR DELETE USING (
    partner_ref = (
      SELECT ref_num FROM partners
      WHERE email = auth.jwt() ->> 'email'
      LIMIT 1
    )
  );


-- ===== 3. applicant-docs storage bucket =====
-- في Supabase Dashboard > Storage > applicant-docs > Policies:
-- أضف Policy: Allow public uploads (INSERT)
-- ما في SQL مباشر للـ storage هنا، افعلها من الـ UI


-- ============================================================
-- بعد تطبيق هذا الملف، أضف في Netlify Environment Variables:
--   SUPABASE_SERVICE_KEY = [من Supabase > Settings > API > service_role key]
--   ADMIN_PASSWORD       = [كلمة سر الأدمن]
-- ============================================================


-- ============================================================
-- إضافة لاحقة (تفعيل الدفع عبر N-Genius) — شغّل هذا القسم في Supabase SQL Editor
-- ============================================================

-- ===== 4. عمود مرجع الدفع (idempotency) =====
-- يخزّن مرجع طلب N-Genius على صف الشريك، لمنع إنشاء حساب مكرر لو تكرر
-- استدعاء register_after_payment (مثلاً لو المستخدم عمل refresh لصفحة النتيجة).
ALTER TABLE partners ADD COLUMN IF NOT EXISTS payment_ref text;
CREATE UNIQUE INDEX IF NOT EXISTS partners_payment_ref_idx
  ON partners (payment_ref) WHERE payment_ref IS NOT NULL;


-- ===== 5. تضييق صلاحيات anon على partners =====
-- شغّل هذا القسم فقط بعد نشر الكود الجديد والتأكد إنه شغّال تمام —
-- تسجيل الدخول (api/partner-auth.js)، لوحة التحكم (api/partner-data.js)،
-- والتسجيل/إكمال الدفع كلها تمر الآن عبر endpoints بمفتاح SUPABASE_SERVICE_KEY
-- (يتجاوز RLS تلقائياً)، فما عاد فيه أي سبب مشروع يحتاج فيه المتصفح
-- (anon key) وصول مباشر لجدول partners.
--
-- partner_login_lookup كانت USING (true) — أي شخص يقدر يقرأ الجدول كامل
-- عبر REST API مباشرة. partner_insert_public كانت WITH CHECK (true) — أي
-- شخص يقدر يضيف صف جديد مباشرة بدون المرور بأي تحقق (OTP أو غيره).
DROP POLICY IF EXISTS "partner_login_lookup" ON partners;
DROP POLICY IF EXISTS "partner_insert_public" ON partners;

-- ملاحظة: partner_select_own و partner_update_own (تعتمدان على auth.jwt())
-- ما تحتاج تعديل — النظام أصلاً ما يستخدم Supabase Auth الحقيقي (تسجيل
-- الدخول مبني على HMAC token مخصص في partner-auth.js)، فهاتين السياستين
-- غير فعّالتين أصلاً على أي وصول anon حالي أو مستقبلي.
