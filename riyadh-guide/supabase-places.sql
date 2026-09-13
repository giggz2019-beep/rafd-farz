-- دليل الرياض — مخطط المرحلة الثانية
-- شغّله في Supabase SQL Editor. القراءة عامة، الكتابة عبر service key فقط.

create extension if not exists pgcrypto;

create table if not exists places (
  id            text primary key,                       -- slug ثابت مثل boulevard-city
  name          text not null,
  name_en       text,
  cat           text not null check (cat in ('cafe','restaurant','sweets','destination','market','men','women','salon','kids','chalet','hotel','event')),
  district      text not null check (district in ('north','center','east','west','south','outside')),
  area          text,
  price         smallint not null default 2 check (price between 1 and 3),
  tags          text[] not null default '{}',
  trend         boolean not null default false,
  "desc"        text,
  ig            text,
  maps_query    text,
  image_url     text,
  lat           double precision,
  lng           double precision,
  verified      boolean not null default false,
  published     boolean not null default false,          -- لا يظهر في التطبيق إلا إذا true
  ends_at       timestamptz,                             -- للفعاليات: يُخفى تلقائيًا بعد هذا التاريخ
  added_at      date not null default current_date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists places_cat_idx on places (cat);
create index if not exists places_trend_idx on places (trend) where trend;

-- اقتراحات المستخدمين من نموذج "أضف مكان"
create table if not exists place_suggestions (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  cat           text,
  district      text,
  area          text,
  ig            text,
  why           text,
  contact       text,
  status        text not null default 'new' check (status in ('new','approved','rejected')),
  created_at    timestamptz not null default now()
);

-- RLS: القراءة العامة للأماكن المنشورة فقط، وكل الكتابة عبر service key
alter table places enable row level security;
alter table place_suggestions enable row level security;

drop policy if exists places_public_read on places;
create policy places_public_read on places
  for select to anon, authenticated
  using (published and (ends_at is null or ends_at > now()));

-- المستخدم المجهول يقدر يضيف اقتراح فقط، لا يقرأ الاقتراحات
drop policy if exists suggestions_public_insert on place_suggestions;
create policy suggestions_public_insert on place_suggestions
  for insert to anon, authenticated
  with check (true);

-- عرض جاهز للتطبيق بنفس أسماء حقول places.js
create or replace view places_public as
  select id, name, name_en as "nameEn", cat, district, area, price, tags, trend,
         "desc", ig, maps_query as maps, image_url as image, verified,
         to_char(added_at, 'YYYY-MM-DD') as "addedAt"
  from places
  where published and (ends_at is null or ends_at > now());
