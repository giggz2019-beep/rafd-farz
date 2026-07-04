-- ============================================================
-- RAFD Security Migration: Tighten RLS with auth.email()
-- تاريخ: 2026-07-04
-- المتطلب: تطبيق بعد اكتمال هجرة Supabase Auth في جميع الصفحات
-- طريقة التطبيق: Supabase Dashboard → SQL Editor
-- ============================================================

-- ============================================================
-- PART 1: partners — ربط SELECT و UPDATE بـ auth.email()
-- ============================================================

-- حذف السياسات المؤقتة التي تسمح لأي مستخدم بالقراءة
DROP POLICY IF EXISTS partner_login_lookup ON public.partners;
DROP POLICY IF EXISTS partner_update_own   ON public.partners;

-- السياسة الجديدة: SELECT — المستخدم يرى سجله فقط
CREATE POLICY partner_select_own ON public.partners
  FOR SELECT
  TO authenticated
  USING (email = auth.email());

-- السياسة الجديدة: UPDATE — المستخدم يعدّل سجله فقط، ولا يستطيع رفع صلاحياته
CREATE POLICY partner_update_own ON public.partners
  FOR UPDATE
  TO authenticated
  USING (email = auth.email())
  WITH CHECK (
    email = auth.email()
    AND status IS NOT DISTINCT FROM (SELECT status FROM public.partners WHERE email = auth.email())
    AND plan   IS NOT DISTINCT FROM (SELECT plan   FROM public.partners WHERE email = auth.email())
  );

-- ============================================================
-- PART 2: السماح للـ anon بقراءة الحالة فقط (للتحقق عند تسجيل الدخول)
-- يمكن حذف هذه السياسة بعد نقل التحقق إلى Edge Function
-- ============================================================

CREATE POLICY partner_anon_status_check ON public.partners
  FOR SELECT
  TO anon
  USING (false);

-- ============================================================
-- PART 3: applications — ربط SELECT بـ auth.email() عبر partner_id
-- ============================================================

DROP POLICY IF EXISTS app_select_own ON public.applications;

CREATE POLICY app_select_own ON public.applications
  FOR SELECT
  TO authenticated
  USING (
    partner_id = (
      SELECT id FROM public.partners WHERE email = auth.email() LIMIT 1
    )
  );

-- ============================================================
-- PART 4: عرض ملخص السياسات
-- ============================================================

SELECT tablename, policyname, cmd, permissive, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('partners', 'applications')
ORDER BY tablename, policyname;
