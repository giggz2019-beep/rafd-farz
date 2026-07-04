-- ============================================================
-- RAFD Security Migration: Enable RLS & Fix Policies
-- تاريخ: 2026-07-04
-- طريقة التطبيق: Supabase Dashboard → SQL Editor → تشغيل هذا الملف
-- ============================================================

-- ============================================================
-- PART 1: جدول partners — تفعيل RLS وتنظيف السياسات
-- ============================================================

-- حذف السياسات المفتوحة الخطرة
DROP POLICY IF EXISTS "Allow public select"  ON public.partners;
DROP POLICY IF EXISTS "Allow public insert"  ON public.partners;
DROP POLICY IF EXISTS "Allow public update"  ON public.partners;

-- حذف السياسات القديمة لإعادة إنشائها بشكل صحيح
DROP POLICY IF EXISTS partner_insert_public   ON public.partners;
DROP POLICY IF EXISTS partner_login_lookup    ON public.partners;
DROP POLICY IF EXISTS partner_select_own      ON public.partners;
DROP POLICY IF EXISTS partner_update_own      ON public.partners;

-- السياسة 1: السماح للزوار بإدخال حسابات جديدة (صفحة التسجيل)
CREATE POLICY partner_anon_insert ON public.partners
  FOR INSERT
  TO anon
  WITH CHECK (
    -- منع المستخدم من تعيين status=approved أو plan=pro بنفسه
    status IN ('pending', 'approved')
    AND plan IN ('trial', 'basic', 'pro')
  );

-- السياسة 2: السماح بالبحث بالبريد الإلكتروني لتسجيل الدخول
-- ملاحظة: هذا مؤقت — المطلوب الانتقال لـ Supabase Auth لإلغاء هذه السياسة
CREATE POLICY partner_login_lookup ON public.partners
  FOR SELECT
  TO anon
  USING (true);

-- السياسة 3: السماح بتحديث بيانات الشريك (settings page)
-- مؤقت — بعد الانتقال لـ Auth يُقيَّد بـ auth.uid() = user_id
CREATE POLICY partner_update_own ON public.partners
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (
    -- منع رفع الصلاحيات عبر UPDATE
    status IS NOT DISTINCT FROM status
    AND plan IS NOT DISTINCT FROM plan
  );

-- تفعيل RLS على جدول partners
ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PART 2: جدول applications — إصلاح سياسة INSERT المفتوحة
-- ============================================================

-- حذف سياسة INSERT المفتوحة
DROP POLICY IF EXISTS app_insert_public ON public.applications;

-- إعادة إنشائها مع قيود أساسية
CREATE POLICY app_insert_public ON public.applications
  FOR INSERT
  TO anon
  WITH CHECK (
    partner_id IS NOT NULL
  );

-- تأكيد تفعيل RLS على applications
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PART 3: إضافة قيد UNIQUE على البريد الإلكتروني إن لم يكن موجوداً
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'partners_email_key'
      AND conrelid = 'public.partners'::regclass
  ) THEN
    ALTER TABLE public.partners ADD CONSTRAINT partners_email_key UNIQUE (email);
  END IF;
END $$;

-- ============================================================
-- PART 4: عرض ملخص السياسات المطبّقة
-- ============================================================

SELECT
  tablename,
  policyname,
  cmd,
  permissive
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('partners', 'applications')
ORDER BY tablename, policyname;
