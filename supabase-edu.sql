-- ============================================================
-- رفد تعليم (RAFD Edu) — مخطط قاعدة البيانات
-- منصة إدارة تعليمية للمدارس (قابلة للتوسّع للجامعات لاحقاً)
--
-- شغّل هذا الملف في: Supabase Dashboard > SQL Editor > New Query
-- ملاحظة: كل الوصول يمر عبر دوال الخادم (api/edu-auth.js و api/edu-data.js)
-- باستخدام SUPABASE_SERVICE_KEY، ولذلك RLS مغلق افتراضياً على كل جدول
-- (deny-all) ولا توجد أي سياسة تسمح للـ anon key بالقراءة أو الكتابة.
-- ============================================================

-- ===== 1. المدارس / الجهات التعليمية =====
CREATE TABLE IF NOT EXISTS edu_schools (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  name_en       text,
  -- نوع الجهة: school الآن، university لاحقاً — نفس المخطط يخدم الاثنين
  org_type      text NOT NULL DEFAULT 'school',
  -- المرحلة: ابتدائي / متوسط / ثانوي / مجمع
  stage         text,
  city          text,
  moe_id        text,                       -- الرقم الوزاري (نور)
  logo_url      text,
  contact_email text,
  contact_phone text,
  plan          text NOT NULL DEFAULT 'trial',
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ===== 2. المستخدمون (إدارة / معلم / ولي أمر / طالب) =====
CREATE TABLE IF NOT EXISTS edu_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid NOT NULL REFERENCES edu_schools(id) ON DELETE CASCADE,
  role          text NOT NULL CHECK (role IN ('school_admin','teacher','parent','student')),
  full_name     text NOT NULL,
  email         text,
  phone         text,
  national_id   text,                       -- رقم الهوية / الإقامة
  password_hash text,
  avatar_url    text,
  active        boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- الدخول يتم بالبريد أو الجوال أو رقم الهوية داخل نطاق المدرسة
CREATE UNIQUE INDEX IF NOT EXISTS edu_users_school_email_uq
  ON edu_users (school_id, lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS edu_users_school_phone_uq
  ON edu_users (school_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS edu_users_role_idx ON edu_users (school_id, role);

-- ===== 3. الفصول والمواد =====
CREATE TABLE IF NOT EXISTS edu_classes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid NOT NULL REFERENCES edu_schools(id) ON DELETE CASCADE,
  name          text NOT NULL,              -- "الصف الخامس - أ"
  grade_level   int,                        -- 5
  section       text,                       -- "أ"
  academic_year text,                       -- "1447"
  homeroom_teacher_id uuid REFERENCES edu_users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS edu_classes_school_idx ON edu_classes (school_id);

CREATE TABLE IF NOT EXISTS edu_subjects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES edu_schools(id) ON DELETE CASCADE,
  name        text NOT NULL,                -- "الرياضيات"
  name_en     text,
  code        text,
  color       text,                         -- لون التمييز في الجدول
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS edu_subjects_school_idx ON edu_subjects (school_id);

-- ===== 4. الطلاب وأولياء الأمور =====
CREATE TABLE IF NOT EXISTS edu_students (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      uuid NOT NULL REFERENCES edu_schools(id) ON DELETE CASCADE,
  -- حساب دخول الطالب (اختياري — الطلاب الصغار قد لا يملكون حساباً)
  user_id        uuid REFERENCES edu_users(id) ON DELETE SET NULL,
  class_id       uuid REFERENCES edu_classes(id) ON DELETE SET NULL,
  full_name      text NOT NULL,
  student_number text,
  national_id    text,
  birth_date     date,
  gender         text,
  photo_url      text,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS edu_students_school_idx ON edu_students (school_id);
CREATE INDEX IF NOT EXISTS edu_students_class_idx  ON edu_students (class_id);

-- ربط ولي الأمر بأبنائه (ولي أمر واحد ↔ عدة أبناء، وطالب ↔ عدة أولياء)
CREATE TABLE IF NOT EXISTS edu_guardians (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      uuid NOT NULL REFERENCES edu_schools(id) ON DELETE CASCADE,
  parent_user_id uuid NOT NULL REFERENCES edu_users(id) ON DELETE CASCADE,
  student_id     uuid NOT NULL REFERENCES edu_students(id) ON DELETE CASCADE,
  relation       text NOT NULL DEFAULT 'ولي أمر',  -- أب / أم / وصي
  is_primary     boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parent_user_id, student_id)
);
CREATE INDEX IF NOT EXISTS edu_guardians_parent_idx  ON edu_guardians (parent_user_id);
CREATE INDEX IF NOT EXISTS edu_guardians_student_idx ON edu_guardians (student_id);

-- ===== 5. الجدول الدراسي =====
CREATE TABLE IF NOT EXISTS edu_timetable (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES edu_schools(id) ON DELETE CASCADE,
  class_id    uuid NOT NULL REFERENCES edu_classes(id) ON DELETE CASCADE,
  subject_id  uuid REFERENCES edu_subjects(id) ON DELETE SET NULL,
  teacher_id  uuid REFERENCES edu_users(id) ON DELETE SET NULL,
  -- 0 = الأحد ... 6 = السبت (أسبوع دراسي سعودي: الأحد–الخميس)
  weekday     int NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  period_no   int NOT NULL,                 -- الحصة رقم
  start_time  time,
  end_time    time,
  room        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, weekday, period_no)
);
CREATE INDEX IF NOT EXISTS edu_timetable_class_idx ON edu_timetable (class_id, weekday);

-- ===== 6. الاختبارات =====
CREATE TABLE IF NOT EXISTS edu_exams (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid NOT NULL REFERENCES edu_schools(id) ON DELETE CASCADE,
  class_id     uuid NOT NULL REFERENCES edu_classes(id) ON DELETE CASCADE,
  subject_id   uuid REFERENCES edu_subjects(id) ON DELETE SET NULL,
  teacher_id   uuid REFERENCES edu_users(id) ON DELETE SET NULL,
  title        text NOT NULL,
  -- quiz = اختبار قصير | midterm = فترة | final = نهائي
  exam_type    text NOT NULL DEFAULT 'quiz',
  exam_date    date NOT NULL,
  start_time   time,
  duration_min int,
  max_score    numeric NOT NULL DEFAULT 100,
  location     text,
  topics       text,                        -- المقرر المطلوب للاختبار
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS edu_exams_class_date_idx ON edu_exams (class_id, exam_date);

-- ===== 7. الدرجات =====
CREATE TABLE IF NOT EXISTS edu_grades (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES edu_schools(id) ON DELETE CASCADE,
  student_id  uuid NOT NULL REFERENCES edu_students(id) ON DELETE CASCADE,
  subject_id  uuid REFERENCES edu_subjects(id) ON DELETE SET NULL,
  exam_id     uuid REFERENCES edu_exams(id) ON DELETE CASCADE,
  term        text,                         -- الفصل الدراسي: "الأول"
  -- نوع الدرجة: exam | homework | participation | project | behavior
  kind        text NOT NULL DEFAULT 'exam',
  title       text,
  score       numeric,
  max_score   numeric NOT NULL DEFAULT 100,
  weight      numeric NOT NULL DEFAULT 1,
  teacher_note text,
  published   boolean NOT NULL DEFAULT true, -- تظهر لولي الأمر؟
  created_by  uuid REFERENCES edu_users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS edu_grades_student_idx ON edu_grades (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS edu_grades_exam_idx    ON edu_grades (exam_id);

-- ===== 8. الواجبات =====
CREATE TABLE IF NOT EXISTS edu_homework (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      uuid NOT NULL REFERENCES edu_schools(id) ON DELETE CASCADE,
  class_id       uuid NOT NULL REFERENCES edu_classes(id) ON DELETE CASCADE,
  subject_id     uuid REFERENCES edu_subjects(id) ON DELETE SET NULL,
  teacher_id     uuid REFERENCES edu_users(id) ON DELETE SET NULL,
  title          text NOT NULL,
  description    text,
  assigned_date  date NOT NULL DEFAULT current_date,
  due_date       date NOT NULL,
  attachment_url text,
  max_score      numeric DEFAULT 10,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS edu_homework_class_due_idx ON edu_homework (class_id, due_date);

-- حالة كل طالب مع كل واجب
CREATE TABLE IF NOT EXISTS edu_homework_status (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid NOT NULL REFERENCES edu_schools(id) ON DELETE CASCADE,
  homework_id  uuid NOT NULL REFERENCES edu_homework(id) ON DELETE CASCADE,
  student_id   uuid NOT NULL REFERENCES edu_students(id) ON DELETE CASCADE,
  -- pending = لم يُسلّم | submitted = سُلّم | late = متأخر | graded = مُصحّح
  status       text NOT NULL DEFAULT 'pending',
  submitted_at timestamptz,
  score        numeric,
  feedback     text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (homework_id, student_id)
);
CREATE INDEX IF NOT EXISTS edu_hw_status_student_idx ON edu_homework_status (student_id);

-- ===== 9. الحضور والغياب =====
CREATE TABLE IF NOT EXISTS edu_attendance (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES edu_schools(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES edu_students(id) ON DELETE CASCADE,
  date       date NOT NULL,
  -- present = حاضر | absent = غائب | late = متأخر | excused = غياب بعذر
  status     text NOT NULL DEFAULT 'present',
  note       text,
  recorded_by uuid REFERENCES edu_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, date)
);
CREATE INDEX IF NOT EXISTS edu_attendance_student_idx ON edu_attendance (student_id, date DESC);

-- ===== 10. الإعلانات (بديل قروبات الواتساب) =====
CREATE TABLE IF NOT EXISTS edu_announcements (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES edu_schools(id) ON DELETE CASCADE,
  class_id   uuid REFERENCES edu_classes(id) ON DELETE CASCADE,  -- NULL = لكل المدرسة
  title      text NOT NULL,
  body       text,
  -- all | parents | students | teachers
  audience   text NOT NULL DEFAULT 'all',
  pinned     boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES edu_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS edu_ann_school_idx ON edu_announcements (school_id, created_at DESC);

-- ===== 11. المراسلات المباشرة (ولي الأمر ↔ المعلم/الإدارة) =====
CREATE TABLE IF NOT EXISTS edu_messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid NOT NULL REFERENCES edu_schools(id) ON DELETE CASCADE,
  student_id   uuid REFERENCES edu_students(id) ON DELETE CASCADE, -- المحادثة تدور حول أي طالب
  from_user_id uuid NOT NULL REFERENCES edu_users(id) ON DELETE CASCADE,
  to_user_id   uuid NOT NULL REFERENCES edu_users(id) ON DELETE CASCADE,
  body         text NOT NULL,
  read_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS edu_messages_to_idx   ON edu_messages (to_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS edu_messages_from_idx ON edu_messages (from_user_id, created_at DESC);

-- ===== 12. رموز التحقق (OTP) لتسجيل الدخول =====
CREATE TABLE IF NOT EXISTS edu_otp (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,                 -- البريد أو الجوال
  code_hash  text NOT NULL,
  attempts   int NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS edu_otp_ident_idx ON edu_otp (identifier, created_at DESC);

-- ===== 13. الرسوم الدراسية والتحصيل المالي =====
-- خطة رسوم = القيمة السنوية لصف أو لفصل، تُقسّم على أقساط.
CREATE TABLE IF NOT EXISTS edu_fee_plans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid NOT NULL REFERENCES edu_schools(id) ON DELETE CASCADE,
  name          text NOT NULL,               -- "رسوم الصف الخامس 1447"
  academic_year text,
  grade_level   int,                         -- تُطبَّق على صف كامل
  class_id      uuid REFERENCES edu_classes(id) ON DELETE SET NULL,
  total_amount  numeric NOT NULL DEFAULT 0,  -- بالريال
  installments  int NOT NULL DEFAULT 1,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS edu_fee_plans_school_idx ON edu_fee_plans (school_id);

-- فاتورة/قسط مستحق على طالب بعينه
CREATE TABLE IF NOT EXISTS edu_invoices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid NOT NULL REFERENCES edu_schools(id) ON DELETE CASCADE,
  student_id    uuid NOT NULL REFERENCES edu_students(id) ON DELETE CASCADE,
  fee_plan_id   uuid REFERENCES edu_fee_plans(id) ON DELETE SET NULL,
  title         text NOT NULL,               -- "القسط الأول"
  academic_year text,
  term          text,
  amount        numeric NOT NULL DEFAULT 0,
  discount      numeric NOT NULL DEFAULT 0,  -- خصم أخوة/منحة
  due_date      date NOT NULL,
  -- unpaid = غير مدفوع | partial = مدفوع جزئياً | paid = مسدّد | cancelled = ملغى
  -- حالة "متأخر" تُحسب عند العرض من due_date، ولا تُخزَّن حتى لا تتقادم
  status        text NOT NULL DEFAULT 'unpaid',
  notes         text,
  created_by    uuid REFERENCES edu_users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS edu_invoices_student_idx ON edu_invoices (student_id, due_date);
CREATE INDEX IF NOT EXISTS edu_invoices_school_idx  ON edu_invoices (school_id, due_date);

-- دفعة مسجّلة على فاتورة (المدرسة تسجّلها بعد الاستلام)
CREATE TABLE IF NOT EXISTS edu_payments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES edu_schools(id) ON DELETE CASCADE,
  invoice_id  uuid NOT NULL REFERENCES edu_invoices(id) ON DELETE CASCADE,
  student_id  uuid NOT NULL REFERENCES edu_students(id) ON DELETE CASCADE,
  amount      numeric NOT NULL,
  -- cash = نقداً | transfer = تحويل | card = شبكة/بطاقة | cheque = شيك
  method      text NOT NULL DEFAULT 'transfer',
  reference   text,                          -- رقم العملية / المرجع
  paid_at     date NOT NULL DEFAULT current_date,
  note        text,
  recorded_by uuid REFERENCES edu_users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS edu_payments_invoice_idx ON edu_payments (invoice_id);
CREATE INDEX IF NOT EXISTS edu_payments_school_idx  ON edu_payments (school_id, paid_at DESC);

-- ===== 14. طلبات العرض من المدارس (نموذج التسويق / المعرض) =====
-- الجدول الوحيد الذي يكتب فيه زائر غير مسجَّل، عبر api/edu-lead.js فقط.
CREATE TABLE IF NOT EXISTS edu_leads (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_name  text NOT NULL,
  contact_name text NOT NULL,
  phone        text NOT NULL,
  email        text,
  city         text,
  students_est text,                         -- عدد الطلاب التقريبي
  source       text DEFAULT 'website',       -- website | expo | referral
  note         text,
  -- new = جديد | contacted = تم التواصل | demo = عرض مجدول | won | lost
  status       text NOT NULL DEFAULT 'new',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS edu_leads_created_idx ON edu_leads (created_at DESC);

-- ===== 15. الحضور بالباركود (طلاب وكادر) =====
-- كل شخص (طالب أو منسوب) له رمز حضور ثابت يُطبع على الأسورة/الميدالية/
-- البطاقة، ورقم سري احتياطي إن نسي حامله.
--
-- ملاحظة أمنية: الرمز الثابت يصلح للأشياء المادية (سوار/ميدالية/بطاقة)
-- لأن حملها هو الإثبات. أما شاشة الجوال فتعرض رمزاً موقّعاً قصير العمر
-- يتولّد في المتصفح من نفس الرمز الثابت (انظر Edu.rollingCode) حتى لا
-- ينفع تصويره وإرساله لزميل.
ALTER TABLE edu_users    ADD COLUMN IF NOT EXISTS checkin_code text;
ALTER TABLE edu_users    ADD COLUMN IF NOT EXISTS pin_hash     text;
ALTER TABLE edu_students ADD COLUMN IF NOT EXISTS checkin_code text;
ALTER TABLE edu_students ADD COLUMN IF NOT EXISTS pin_hash     text;

-- الرمز فريد على مستوى النظام كله: قارئ الباركود لا يعرف أي مدرسة يقرأ لها
CREATE UNIQUE INDEX IF NOT EXISTS edu_users_checkin_uq
  ON edu_users (checkin_code) WHERE checkin_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS edu_students_checkin_uq
  ON edu_students (checkin_code) WHERE checkin_code IS NOT NULL;

-- كيف سُجّل الحضور ومتى بالضبط
-- qr = مسح رمز | pin = رقم سري | manual = إدخال يدوي من الإدارة
-- | self = المنسوب سجّل نفسه | biometric = بصمة (محجوز لتكامل مستقبلي)
ALTER TABLE edu_attendance ADD COLUMN IF NOT EXISTS check_in_at timestamptz;
ALTER TABLE edu_attendance ADD COLUMN IF NOT EXISTS method      text;

-- حضور المنسوبين (معلمون وإدارة) — منفصل عن حضور الطلاب
CREATE TABLE IF NOT EXISTS edu_staff_attendance (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES edu_schools(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES edu_users(id) ON DELETE CASCADE,
  date        date NOT NULL,
  -- present = حاضر | absent = غائب | late = متأخر | leave = إجازة/مأذونية
  status      text NOT NULL DEFAULT 'present',
  check_in_at timestamptz,
  method      text,
  -- سبب الغياب حين يسجّله المنسوب من حسابه
  reason      text,
  -- هل سجّله بنفسه من بيته؟ يميّزه عن تسجيل الإدارة
  self_report boolean NOT NULL DEFAULT false,
  recorded_by uuid REFERENCES edu_users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);
CREATE INDEX IF NOT EXISTS edu_staff_att_school_idx ON edu_staff_attendance (school_id, date DESC);

-- إعدادات الدوام لكل مدرسة — تحدد متى يُعتبر الحضور تأخيراً
ALTER TABLE edu_schools ADD COLUMN IF NOT EXISTS day_start   time DEFAULT '07:00';
ALTER TABLE edu_schools ADD COLUMN IF NOT EXISTS late_after  time DEFAULT '07:15';

-- ============================================================
-- الأمان: RLS مفعّل مع رفض افتراضي على كل الجداول.
-- لا سياسات SELECT/INSERT عامة — الوصول حصراً عبر service key
-- من دوال Vercel، والتي تتحقق من الدور والصلاحية بنفسها.
-- ============================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'edu_schools','edu_users','edu_classes','edu_subjects','edu_students',
    'edu_guardians','edu_timetable','edu_exams','edu_grades','edu_homework',
    'edu_homework_status','edu_attendance','edu_announcements','edu_messages','edu_otp',
    'edu_fee_plans','edu_invoices','edu_payments','edu_leads','edu_staff_attendance'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    -- إلغاء أي صلاحيات ممنوحة للأدوار العامة
    EXECUTE format('REVOKE ALL ON %I FROM anon, authenticated', t);
  END LOOP;
END $$;

-- ============================================================
-- بيانات تجريبية (اختيارية) — احذف هذا القسم في الإنتاج
-- تنشئ مدرسة واحدة + فصل + مواد + طالب + ولي أمر لتجربة النظام.
-- كلمة المرور لكل الحسابات التجريبية: Rafd@2030
-- (الهاش أدناه scrypt بنفس صيغة api/_lib/password.js — ولّده عبر
--  node -e "require('./api/_lib/password').hash('Rafd@2030').then(console.log)")
-- ============================================================
-- INSERT INTO edu_schools (name, name_en, stage, city, plan)
--   VALUES ('مدرسة الرواد الأهلية', 'Al-Ruwwad Private School', 'ابتدائي', 'الرياض', 'trial');
