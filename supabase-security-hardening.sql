-- ============================================================
-- RAFD Digital — تقوية أمان قاعدة البيانات والتخزين (شاملة)
-- شغّل هذا الملف في: Supabase Dashboard > SQL Editor > New Query
-- المشروع: ycnnawohrbbluawxzttt
--
-- آمن للتشغيل أكثر من مرة (idempotent).
-- شغّله فقط بعد نشر الكود المرافق له على Vercel (نفس الـ commit) —
-- الكود الجديد يخزّن مسارات الملفات ويوقّعها server-side بدل الروابط العامة.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- القسم 0: فحص الوضع الحالي (شغّله أولاً واقرأ النتائج)
-- ════════════════════════════════════════════════════════════

-- 0.1 هل RLS مفعّل على الجداول؟ (rowsecurity = true يعني مفعّل)
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- 0.2 ما هي السياسات الموجودة حالياً؟
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 0.3 حالة الـ buckets — public = true يعني أي شخص يفتح الملفات برابط مباشر
SELECT id, name, public FROM storage.buckets;


-- ════════════════════════════════════════════════════════════
-- القسم 1: تفعيل RLS على كل الجداول (بدون سياسات مفتوحة)
--
-- المبدأ: كل وصول للبيانات يمر عبر دوال Vercel بمفتاح service_role
-- (يتجاوز RLS تلقائياً). المتصفح لا يملك أي مفتاح، فأي وصول مباشر
-- بمفتاح anon يجب أن يُرفض بالكامل. RLS مفعّل + صفر سياسات = رفض كامل.
-- ════════════════════════════════════════════════════════════

ALTER TABLE public.partners     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;

-- حذف السياسات القديمة المتساهلة إن وُجدت (كانت تسمح لأي شخص
-- بقراءة جدول الشركاء كاملاً أو إدخال صفوف بدون تحقق):
DROP POLICY IF EXISTS "partner_login_lookup"  ON public.partners;
DROP POLICY IF EXISTS "partner_insert_public" ON public.partners;
DROP POLICY IF EXISTS "partner_select_own"    ON public.partners;
DROP POLICY IF EXISTS "partner_update_own"    ON public.partners;
DROP POLICY IF EXISTS "app_insert_public"     ON public.applications;
DROP POLICY IF EXISTS "app_select_own"        ON public.applications;
DROP POLICY IF EXISTS "app_update_own"        ON public.applications;
DROP POLICY IF EXISTS "app_delete_own"        ON public.applications;
-- ملاحظة: سياسات *_own كانت تعتمد على Supabase Auth الذي لا يستخدمه
-- النظام أصلاً (الجلسات HMAC مخصصة) — فهي ميتة ولا تضيف حماية.
-- إزالتها توضّح الصورة: كل شيء عبر service_role حصراً.

-- khalid_feedback مفعّل عليه RLS أصلاً من ملفه — نتأكد فقط:
ALTER TABLE IF EXISTS public.khalid_feedback ENABLE ROW LEVEL SECURITY;


-- ════════════════════════════════════════════════════════════
-- القسم 2: تأمين التخزين (Storage)
-- ════════════════════════════════════════════════════════════

-- 2.1 إنشاء bucket عام منفصل لشعارات/صور الشركاء (غير حساسة)
INSERT INTO storage.buckets (id, name, public)
VALUES ('partner-logos', 'partner-logos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 2.2 جعل bucket مستندات المتقدمين خاصاً — هذا هو الأهم:
-- صور الهوية والسير الذاتية لن تعود متاحة لأي شخص يملك الرابط.
-- الوصول الوحيد بعدها: روابط موقّعة مؤقتة يُصدرها السيرفر للشريك
-- المصرّح له فقط (الكود الجديد يفعل هذا تلقائياً عند فتح اللوحة).
UPDATE storage.buckets SET public = false WHERE id = 'applicant-docs';

-- 2.3 حذف أي سياسات storage متساهلة على applicant-docs إن وُجدت
-- (أنشئت سابقاً من الواجهة "Allow public uploads"):
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
  LOOP
    -- احذف فقط السياسات التي تذكر applicant-docs في تعريفها
    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
        AND policyname = pol.policyname
        AND (COALESCE(qual,'') ILIKE '%applicant-docs%'
          OR COALESCE(with_check,'') ILIKE '%applicant-docs%')
    ) THEN
      EXECUTE format('DROP POLICY %I ON storage.objects', pol.policyname);
    END IF;
  END LOOP;
END $$;

-- ملاحظة: الرفع نفسه يتم عبر روابط رفع موقّعة يُصدرها السيرفر
-- بمفتاح service_role (يتجاوز سياسات storage) — فلا حاجة لأي سياسة
-- INSERT عامة على applicant-docs بعد الآن.


-- ════════════════════════════════════════════════════════════
-- القسم 3: تحقق نهائي (شغّله بعد الأقسام أعلاه وتأكد من النتائج)
-- ════════════════════════════════════════════════════════════

-- 3.1 يجب أن تكون rowsecurity = true لكل الجداول:
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- 3.2 يجب ألا تبقى أي سياسة على partners أو applications:
SELECT tablename, policyname FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('partners','applications');
-- (النتيجة المطلوبة: 0 صفوف)

-- 3.3 يجب أن يظهر applicant-docs بـ public = false و partner-logos بـ true:
SELECT id, public FROM storage.buckets
WHERE id IN ('applicant-docs','partner-logos');


-- ════════════════════════════════════════════════════════════
-- بعد التشغيل — خطوات يدوية في لوحات التحكم:
--
-- 1) Vercel > Settings > Environment Variables — أضف متغيراً جديداً:
--      PARTNER_SECRET = [نص عشوائي طويل 64+ حرفاً — مثلاً من: openssl rand -hex 48]
--    حالياً توقيع الجلسات يستخدم SUPABASE_SERVICE_KEY كبديل؛ فصلهما
--    أفضل أمنياً (لو تسرب أحدهما لا يسقط الآخر).
--    ⚠️ تنبيه: إضافة PARTNER_SECRET تُبطل الجلسات الحالية — الشركاء
--    يعيدون تسجيل الدخول مرة واحدة فقط (مدتها ساعتان أصلاً).
--
-- 2) (اختياري لكن مُوصى به بقوة) لتفعيل rate limiting حقيقي:
--    Vercel > Storage > أنشئ Upstash Redis (KV) واربطه بالمشروع —
--    سيضيف KV_REST_API_URL و KV_REST_API_TOKEN تلقائياً والكود
--    الجديد يلتقطهما بدون أي تعديل إضافي.
--
-- 3) شعارات الشركاء المرفوعة سابقاً كانت داخل applicant-docs وستختفي
--    بعد جعله خاصاً (تظهر الأحرف الأولى بدلها تلقائياً) — كل شريك
--    يعيد رفع شعاره مرة واحدة من الإعدادات. الرفع الجديد يذهب
--    للـ bucket العام partner-logos.
-- ============================================================
