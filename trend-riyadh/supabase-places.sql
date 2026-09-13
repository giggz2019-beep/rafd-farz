-- ترند الرياض — مخطط المرحلة الثانية
-- شغّله في Supabase SQL Editor. القراءة عامة، الكتابة عبر service key فقط.

create extension if not exists pgcrypto;

-- الموصون (المستخدمون الذين يضيفون توصيات ويأخذون نسبة)
create table if not exists recommenders (
  id            uuid primary key default gen_random_uuid(),
  handle        text unique not null,                 -- اسم/حساب يظهر على البطاقة
  ref_code      text unique not null,                 -- كود الإحالة في الروابط ?ref=
  phone         text,
  created_at    timestamptz not null default now()
);

-- الشركاء المدفوعون (الإعلانات)
create table if not exists sponsors (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  contact       text,
  starts_at     date not null,
  ends_at       date not null,
  monthly_fee   numeric(10,2),
  created_at    timestamptz not null default now()
);

create table if not exists places (
  id            text primary key,                       -- slug ثابت مثل boulevard-city
  name          text not null,
  name_en       text,
  sec           text not null,                          -- القسم الرئيسي (من RIYADH_SECTIONS)
  sub           text not null,                          -- القسم الفرعي
  audience      text not null default 'all' check (audience in ('men','women','family','all')),
  district      text not null check (district in ('north','center','east','west','south','outside')),
  area          text,
  price         smallint not null default 2 check (price between 1 and 3),
  tags          text[] not null default '{}',
  trend         boolean not null default false,          -- قرار المشرف — لا يُباع
  sponsor_id    uuid references sponsors(id),            -- إذا موجود = مكان مدفوع (شارة إعلان)
  recommender_id uuid references recommenders(id),
  google_place_id text,                                  -- الحقل الوحيد المسموح تخزينه من قوقل
  "desc"        text,
  ig            text,
  maps_query    text,
  image_url     text,
  verified      boolean not null default false,
  published     boolean not null default false,
  ends_at       timestamptz,                             -- للفعاليات
  added_at      date not null default current_date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists places_sec_sub_idx on places (sec, sub);
create index if not exists places_trend_idx on places (trend) where trend;

-- توصيات المستخدمين من نموذج "أضف توصيتك"
create table if not exists place_suggestions (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  sec           text, sub text, district text, area text, ig text, why text,
  by_handle     text,                                    -- اسم الموصي كما كتبه
  contact       text,
  status        text not null default 'new' check (status in ('new','approved','rejected')),
  created_at    timestamptz not null default now()
);

-- عدّاد زيارات لكل مكان (أساس حساب نسبة الموصي)
create table if not exists place_clicks (
  id            bigint generated always as identity primary key,
  place_id      text not null references places(id),
  ref_code      text,                                    -- من رابط ?ref=
  kind          text not null default 'view' check (kind in ('view','maps','instagram','share')),
  created_at    timestamptz not null default now()
);
create index if not exists place_clicks_place_idx on place_clicks (place_id, created_at);

-- RLS
alter table places enable row level security;
alter table place_suggestions enable row level security;
alter table place_clicks enable row level security;
alter table recommenders enable row level security;
alter table sponsors enable row level security;

drop policy if exists places_public_read on places;
create policy places_public_read on places for select to anon, authenticated
  using (published and (ends_at is null or ends_at > now()));

drop policy if exists suggestions_public_insert on place_suggestions;
create policy suggestions_public_insert on place_suggestions for insert to anon, authenticated with check (true);

drop policy if exists clicks_public_insert on place_clicks;
create policy clicks_public_insert on place_clicks for insert to anon, authenticated with check (true);
-- recommenders و sponsors: لا سياسات عامة = service key فقط

-- عرض جاهز للتطبيق بنفس أسماء حقول places.js
create or replace view places_public as
  select p.id, p.name, p.name_en as "nameEn", p.sec, p.sub, p.audience, p.district, p.area, p.price, p.tags,
         (p.trend and p.sponsor_id is null) as trend,
         (p.sponsor_id is not null and s.ends_at >= current_date) as sponsored,
         r.handle as "recommendedBy",
         p.google_place_id as "placeId",
         p."desc", p.ig, p.maps_query as maps, p.image_url as image, p.verified,
         to_char(p.added_at, 'YYYY-MM-DD') as "addedAt",
         to_char(p.ends_at, 'YYYY-MM-DD') as "endsAt"
  from places p
  left join sponsors s on s.id = p.sponsor_id
  left join recommenders r on r.id = p.recommender_id
  where p.published and (p.ends_at is null or p.ends_at > now());
