-- ============================================================
--  سفراء رفد  —  فريق المبيعات والتسويق بالعمولة  (team.html)
--  Run this in the Supabase SQL editor of the RAFD project.
--  It is idempotent: running it again is a no-op.
--
--  Design notes
--  ------------
--  * The browser talks to Supabase directly with the ANON key (api/ is at
--    Vercel's 12-function Hobby limit), so every table here is DENY-ALL:
--    RLS on, no policies, and every privilege revoked from anon /
--    authenticated / public by name. The only door is the SECURITY
--    DEFINER functions at the bottom.
--  * An ambassador proves who she is with a session token returned by
--    team_register / team_login. Only its SHA-256 is stored.
--  * Attribution is decided HERE, never in the page: the first ambassador
--    to register a client's mobile owns that client for 180 days. A later
--    claim on the same number is kept (so nobody can say it vanished) but
--    stamped `duplicate`. The ambassador cannot change a status, a deal
--    value, a commission or a timestamp — only the operator can, and every
--    change is written to team_lead_events. That log is the proof for
--    both sides.
--  * IBAN, password hash and the operator secret never leave through any
--    function an ambassador or the public can call. team_me() returns the
--    IBAN masked.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- tables ----------

create table if not exists team_members (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,                 -- referral code, e.g. RF7K3M
  full_name       text not null,
  phone           text not null unique,
  city            text,
  tiktok          text,
  pass_hash       text not null,
  status          text not null default 'trial',        -- trial | contracted | suspended
  iban            text,
  iban_name       text,
  bank            text,
  iban_at         timestamptz,
  terms_at        timestamptz not null default now(),   -- when she accepted the rules
  created_at      timestamptz not null default now(),
  constraint team_m_phone   check (phone ~ '^05[0-9]{8}$'),
  constraint team_m_name    check (char_length(full_name) between 3 and 60),
  constraint team_m_city    check (city is null or char_length(city) <= 40),
  constraint team_m_tiktok  check (tiktok is null or char_length(tiktok) <= 40),
  constraint team_m_status  check (status in ('trial','contracted','suspended')),
  constraint team_m_iban    check (iban is null or iban ~ '^SA[0-9]{22}$'),
  constraint team_m_ibanname check (iban_name is null or char_length(iban_name) between 3 and 80),
  constraint team_m_bank    check (bank is null or char_length(bank) <= 40)
);

alter table team_members add column if not exists agreed_rate numeric(5,2);
alter table team_members add column if not exists agreement_text text;
alter table team_members add column if not exists agreement_text_en text;

create table if not exists team_sessions (
  token_hash  text primary key,
  member_id   uuid not null references team_members(id) on delete cascade,
  expires_at  timestamptz not null default now() + interval '60 days'
);

create table if not exists team_leads (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references team_members(id) on delete cascade,
  client_name   text not null,
  company       text,
  client_phone  text not null,
  city          text,
  service       text,
  notes         text,
  source        text not null default 'manual',   -- manual (she typed it) | link (the client filled her link)
  status        text not null default 'new',      -- new | contacted | negotiating | won | lost | duplicate
  deal_value    numeric(12,2),
  commission    numeric(12,2),
  paid_at       timestamptz,
  paid_ref      text,
  admin_note    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint team_l_phone   check (client_phone ~ '^05[0-9]{8}$'),
  constraint team_l_name    check (char_length(client_name) between 2 and 80),
  constraint team_l_company check (company is null or char_length(company) <= 100),
  constraint team_l_city    check (city is null or char_length(city) <= 40),
  constraint team_l_service check (service is null or char_length(service) <= 60),
  constraint team_l_notes   check (notes is null or char_length(notes) <= 500),
  constraint team_l_source  check (source in ('manual','link')),
  constraint team_l_status  check (status in ('new','contacted','negotiating','won','lost','duplicate')),
  constraint team_l_money   check ((deal_value is null or deal_value between 0 and 100000000)
                               and (commission is null or commission between 0 and 100000000))
);
create index if not exists team_leads_phone_idx  on team_leads (client_phone, created_at);
create index if not exists team_leads_member_idx on team_leads (member_id, created_at desc);

create table if not exists team_lead_events (
  id        bigserial primary key,
  lead_id   uuid not null references team_leads(id) on delete cascade,
  at        timestamptz not null default now(),
  actor     text not null,          -- 'member' | 'client' | 'admin'
  action    text not null,
  detail    jsonb
);

create table if not exists team_config (key text primary key, value text not null);
insert into team_config(key, value)
  values ('admin_secret', encode(extensions.gen_random_bytes(12), 'hex'))
  on conflict (key) do nothing;
-- Read it once in the SQL editor:   select value from team_config where key='admin_secret';
-- Rotate it:                        update team_config set value='…' where key='admin_secret';

-- ---------- the membership agreement ----------
-- RAFD's written commitment to each ambassador. Its text lives here with
-- placeholders ({rate} {days} {priority} {name} {phone}) and is RENDERED and
-- SNAPSHOTTED onto the member at registration together with the rate, so a
-- later change of rate or wording never touches what someone already accepted.
insert into team_config(key, value) values ('commission_rate', '5') on conflict (key) do nothing;
insert into team_config(key, value) values ('payout_days', '15') on conflict (key) do nothing;
insert into team_config(key, value) values ('agreement', $agr$## أطراف الاتفاقية
- الطرف الأول: شركة رفد الرقمية، ويُشار إليها بـ«رفد».
- الطرف الثاني: {name}، جوال رقم {phone}، ويُشار إليه بـ«المندوب».
## طبيعة العلاقة
- يعمل المندوب مع رفد بصفة مستقلة وبنظام العمولة، ولا تُنشئ هذه الاتفاقية علاقة عمل بين الطرفين ولا تُعد عقد عمل، ولا يترتب عليها أجر ثابت أو بدلات أو أي من حقوق العامل المقررة نظاماً.
- لرفد أن تعرض على المندوب الذي يُثبت كفاءته عقداً مستقلاً براتب وعمولة، ويخضع ذلك العقد لشروطه الخاصة.
## العمولة
- تلتزم رفد بأن تدفع للمندوب عمولة نسبتها ({rate}%) من قيمة العقد الأول المبرم مع كل عميل يُنسب إليه وفق هذه الاتفاقية.
- تُحتسب العمولة على المبالغ المحصّلة فعلياً من العميل، غير شاملة ضريبة القيمة المضافة.
- تُستحق العمولة بعد توقيع العميل العقد وتحصيل قيمته، وتُحوَّل خلال ({days}) يوماً من تاريخ التحصيل إلى الحساب البنكي المسجّل باسم المندوب في المنصة.
- تبقى النسبة الواردة في هذه الاتفاقية سارية على المندوب، ولا يسري عليه أي تعديل لاحق عليها إلا بموافقته.
## نسبة العميل إلى المندوب
- يُنسب العميل إلى أول مندوب يسجّله في المنصة، وتبقى الأولوية له مدة ({priority}) يوماً من تاريخ التسجيل.
- يُعد تسجيل المنصة، بتاريخه ووقته المحفوظين آلياً، المرجع المعتمد بين الطرفين عند أي اختلاف.
## التزامات المندوب
- تقديم معلومات صحيحة عن نفسه وعن العملاء الذين يسجّلهم.
- عدم تقديم أي أسعار أو خصومات أو التزامات باسم رفد خارج عروض الأسعار الصادرة منها رسمياً.
- المحافظة على سرية بيانات العملاء والأسعار، وعدم استخدامها لغير أغراض هذه الاتفاقية.
## إنهاء المشاركة
- لأي من الطرفين إنهاء المشاركة في أي وقت بإشعار عبر المنصة أو كتابياً.
- يحتفظ المندوب بعد الإنهاء بحقه في عمولة العملاء المنسوبين إليه قبل الإنهاء، متى تعاقدوا خلال مدة الأولوية.
- لرفد إيقاف حساب المندوب إذا أخلّ بأي من التزاماته، مع حفظ حقه في العمولات المستحقة عن الفترة السابقة للإخلال.
## أحكام عامة
- تخضع هذه الاتفاقية لأنظمة المملكة العربية السعودية.
- تُعد موافقة المندوب الإلكترونية على هذه الاتفاقية عند التسجيل إقراراً ملزماً للطرفين، وتحفظ المنصة نسخة منها في حساب المندوب بتاريخ الموافقة ونسبة العمولة المتفق عليها.$agr$) on conflict (key) do nothing;
insert into team_config(key, value) values ('agreement_en', $agr$## Parties
- First party: RAFD Digital ("RAFD").
- Second party: {name}, mobile number {phone} (the "Representative").
## Nature of the relationship
- The Representative works with RAFD independently and on a commission basis. This agreement does not create an employment relationship between the parties, is not an employment contract, and gives rise to no fixed salary, allowances or any statutory employee entitlements.
- RAFD may offer a Representative who proves their ability a separate contract with a salary and commission, which will be governed by its own terms.
## Commission
- RAFD undertakes to pay the Representative a commission of ({rate}%) of the value of the first contract concluded with each client attributed to them under this agreement.
- Commission is calculated on amounts actually collected from the client, excluding VAT.
- Commission becomes due once the client has signed the contract and its value has been collected, and is transferred within ({days}) days of collection to the bank account registered in the Representative's name on the platform.
- The rate stated in this agreement continues to apply to the Representative, and no later change to it applies to them without their consent.
## Attribution of clients
- A client is attributed to the first Representative who registers them on the platform, and that priority is kept for ({priority}) days from the date of registration.
- The platform's record, with its automatically stored date and time, is the agreed reference between the parties in the event of any dispute.
## Representative's obligations
- To provide accurate information about themselves and about the clients they register.
- Not to offer any prices, discounts or commitments on RAFD's behalf outside the quotations RAFD issues officially.
- To keep client data and prices confidential and not use them for any purpose other than this agreement.
## Ending participation
- Either party may end participation at any time by notice through the platform or in writing.
- After participation ends, the Representative keeps the right to commission on clients attributed to them before it ended, provided they contract within the priority period.
- RAFD may suspend the Representative's account for breach of any of their obligations, without prejudice to commission already earned for the period before the breach.
## General provisions
- This agreement is governed by the laws of the Kingdom of Saudi Arabia.
- The Representative's electronic acceptance of this agreement at registration is a binding acknowledgement by both parties, and the platform keeps a copy of it in the Representative's account with the date of acceptance and the agreed commission rate.$agr$) on conflict (key) do nothing;

create table if not exists team_attempts (
  key  text not null,
  at   timestamptz not null default now()
);
create index if not exists team_attempts_idx on team_attempts (key, at);

-- ---------- deny-all ----------

alter table team_members     enable row level security;
alter table team_sessions    enable row level security;
alter table team_leads       enable row level security;
alter table team_lead_events enable row level security;
alter table team_config      enable row level security;
alter table team_attempts    enable row level security;

revoke all on team_members, team_sessions, team_leads, team_lead_events, team_config, team_attempts
  from public, anon, authenticated;
revoke all on sequence team_lead_events_id_seq from public, anon, authenticated;

-- ---------- internal helpers (NOT callable from the browser) ----------

create or replace function team_iban_ok(p text) returns boolean
language plpgsql immutable as $$
declare s text; r int := 0; i int; c text;
begin
  if p is null or p !~ '^SA[0-9]{22}$' then return false; end if;
  s := substr(p, 5) || '2810' || substr(p, 3, 2);         -- move SA+check to the end, S=28 A=10
  for i in 1..length(s) loop
    c := substr(s, i, 1);
    r := (r * 10 + c::int) % 97;
  end loop;
  return r = 1;
end $$;

create or replace function team_throttle(p_key text, p_max int, p_window interval) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  delete from team_attempts where at < now() - interval '1 day';
  return (select count(*) from team_attempts where key = p_key and at > now() - p_window) < p_max;
end $$;

create or replace function team_member_of(p_token text) returns uuid
language sql security definer set search_path = public, extensions stable as $$
  select s.member_id from team_sessions s join team_members m on m.id = s.member_id
   where s.token_hash = encode(digest(coalesce(p_token,''), 'sha256'), 'hex')
     and s.expires_at > now() and m.status <> 'suspended'
$$;

create or replace function team_new_session(p_member uuid) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare t text := encode(gen_random_bytes(24), 'hex');
begin
  delete from team_sessions where expires_at < now();
  insert into team_sessions(token_hash, member_id) values (encode(digest(t, 'sha256'), 'hex'), p_member);
  return t;
end $$;

create or replace function team_is_admin(p_secret text) returns boolean
language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  if not team_throttle('admin', 10, interval '15 minutes') then
    raise exception 'too_many';
  end if;
  ok := exists (select 1 from team_config where key = 'admin_secret' and value = coalesce(p_secret,''));
  if not ok then insert into team_attempts(key) values ('admin'); end if;
  return ok;
end $$;

create or replace function team_agreement_render(p_key text, p_name text, p_phone text) returns text
language sql security definer set search_path = public stable as $$
  select replace(replace(replace(replace(replace(
           (select value from team_config where key = p_key),
           '{rate}',     (select trim(trailing '.' from to_char(value::numeric, 'FM999990.99')) from team_config where key = 'commission_rate')),
           '{days}',     (select value from team_config where key = 'payout_days')),
           '{priority}', '180'),
           '{name}',     coalesce(nullif(trim(p_name),''), '________')),
           '{phone}',    coalesce(nullif(trim(p_phone),''), '________'))
$$;

-- insert a lead and decide attribution in one place
create or replace function team_insert_lead(p_member uuid, p_source text, p_name text, p_company text,
  p_phone text, p_city text, p_service text, p_notes text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_id uuid; v_status text := 'new';
begin
  select member_id into v_owner from team_leads
   where client_phone = p_phone and status <> 'duplicate'
     and created_at > now() - interval '180 days'
   order by created_at limit 1;
  if v_owner = p_member then return jsonb_build_object('error', 'mine'); end if;
  if v_owner is not null then v_status := 'duplicate'; end if;

  insert into team_leads(member_id, client_name, company, client_phone, city, service, notes, source, status)
  values (p_member, trim(p_name), nullif(trim(p_company),''), p_phone, nullif(trim(p_city),''),
          nullif(trim(p_service),''), nullif(trim(p_notes),''), p_source, v_status)
  returning id into v_id;
  insert into team_lead_events(lead_id, actor, action, detail)
    values (v_id, case when p_source = 'link' then 'client' else 'member' end, 'created',
            jsonb_build_object('status', v_status));
  return jsonb_build_object('ok', true, 'id', v_id, 'status', v_status);
end $$;

revoke all on function team_iban_ok(text)                     from public, anon, authenticated;
revoke all on function team_throttle(text,int,interval)       from public, anon, authenticated;
revoke all on function team_member_of(text)                   from public, anon, authenticated;
revoke all on function team_new_session(uuid)                 from public, anon, authenticated;
revoke all on function team_is_admin(text)                    from public, anon, authenticated;
revoke all on function team_insert_lead(uuid,text,text,text,text,text,text,text) from public, anon, authenticated;
revoke all on function team_agreement_render(text,text,text)  from public, anon, authenticated;

-- ---------- public API (callable with the anon key) ----------

create or replace function team_register(p_name text, p_phone text, p_city text, p_tiktok text,
  p_password text, p_agree boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid; v_code text; i int := 0;
begin
  if not coalesce(p_agree, false) then return jsonb_build_object('error','terms'); end if;
  if p_phone !~ '^05[0-9]{8}$' then return jsonb_build_object('error','phone'); end if;
  if char_length(coalesce(p_password,'')) < 6 then return jsonb_build_object('error','password'); end if;
  if char_length(trim(coalesce(p_name,''))) < 3 then return jsonb_build_object('error','name'); end if;
  if not team_throttle('reg', 30, interval '1 hour') then return jsonb_build_object('error','too_many'); end if;
  if exists (select 1 from team_members where phone = p_phone) then return jsonb_build_object('error','exists'); end if;
  loop
    v_code := 'RF' || upper(substr(translate(encode(gen_random_bytes(6),'base64'),'+/=0O1lI','XYZ'), 1, 4));
    exit when not exists (select 1 from team_members where code = v_code) or i > 20;
    i := i + 1;
  end loop;
  insert into team_members(code, full_name, phone, city, tiktok, pass_hash, agreed_rate, agreement_text, agreement_text_en)
  values (v_code, trim(p_name), p_phone, nullif(trim(p_city),''), nullif(trim(p_tiktok),''),
          crypt(p_password, gen_salt('bf')),
          (select value::numeric from team_config where key = 'commission_rate'),
          team_agreement_render('agreement', p_name, p_phone),
          team_agreement_render('agreement_en', p_name, p_phone))
  returning id into v_id;
  insert into team_attempts(key) values ('reg');
  return jsonb_build_object('ok', true, 'token', team_new_session(v_id));
end $$;

create or replace function team_login(p_phone text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare m team_members;
begin
  if not team_throttle('login:' || coalesce(p_phone,''), 8, interval '15 minutes') then
    return jsonb_build_object('error','too_many');
  end if;
  select * into m from team_members where phone = p_phone;
  if m.id is null or m.pass_hash <> crypt(coalesce(p_password,''), m.pass_hash) then
    insert into team_attempts(key) values ('login:' || coalesce(p_phone,''));
    return jsonb_build_object('error','bad');
  end if;
  if m.status = 'suspended' then return jsonb_build_object('error','suspended'); end if;
  return jsonb_build_object('ok', true, 'token', team_new_session(m.id));
end $$;

create or replace function team_logout(p_token text) returns void
language sql security definer set search_path = public, extensions as $$
  delete from team_sessions where token_hash = encode(digest(coalesce(p_token,''), 'sha256'), 'hex')
$$;

create or replace function team_me(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := team_member_of(p_token); m team_members;
begin
  if v is null then return jsonb_build_object('error','auth'); end if;
  select * into m from team_members where id = v;
  return jsonb_build_object(
    'member', jsonb_build_object(
      'name', m.full_name, 'phone', m.phone, 'city', m.city, 'tiktok', m.tiktok,
      'code', m.code, 'status', m.status, 'created_at', m.created_at,
      'iban_masked', case when m.iban is null then null
                          else 'SA•• •••• •••• •••• ••' || right(m.iban, 4) end,
      'iban_name', m.iban_name, 'bank', m.bank, 'iban_at', m.iban_at,
      'agreed_rate', m.agreed_rate, 'agreed_at', m.terms_at,
      'agreement_text', m.agreement_text, 'agreement_text_en', m.agreement_text_en),
    'catalog', (select coalesce(jsonb_agg(e - 'price'), '[]'::jsonb)
                  from team_config c, jsonb_array_elements(c.value::jsonb) e where c.key = 'catalog'),
    'leads', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'client_name', l.client_name, 'company', l.company,
        'client_phone', l.client_phone, 'city', l.city, 'service', l.service, 'notes', l.notes,
        'source', l.source, 'status', l.status, 'deal_value', l.deal_value,
        'commission', l.commission, 'paid_at', l.paid_at, 'paid_ref', l.paid_ref,
        'created_at', l.created_at, 'updated_at', l.updated_at,
        'quote', (select to_jsonb(q) - 'lead_id' from team_quotes q where q.lead_id = l.id))
        order by l.created_at desc)
      from team_leads l where l.member_id = v), '[]'::jsonb));
end $$;

create or replace function team_add_lead(p_token text, p_name text, p_company text, p_phone text,
  p_city text, p_service text, p_notes text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := team_member_of(p_token);
begin
  if v is null then return jsonb_build_object('error','auth'); end if;
  if p_phone !~ '^05[0-9]{8}$' then return jsonb_build_object('error','phone'); end if;
  if char_length(trim(coalesce(p_name,''))) < 2 then return jsonb_build_object('error','name'); end if;
  if not team_throttle('lead:' || v, 40, interval '1 hour') then return jsonb_build_object('error','too_many'); end if;
  insert into team_attempts(key) values ('lead:' || v);
  return team_insert_lead(v, 'manual', p_name, p_company, p_phone, p_city, p_service, p_notes);
end $$;

create or replace function team_set_iban(p_token text, p_iban text, p_name text, p_bank text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := team_member_of(p_token); x text := upper(regexp_replace(coalesce(p_iban,''), '\s', '', 'g'));
begin
  if v is null then return jsonb_build_object('error','auth'); end if;
  if not team_iban_ok(x) then return jsonb_build_object('error','iban'); end if;
  if char_length(trim(coalesce(p_name,''))) < 3 then return jsonb_build_object('error','name'); end if;
  update team_members set iban = x, iban_name = trim(p_name), bank = nullif(trim(p_bank),''), iban_at = now()
   where id = v;
  return jsonb_build_object('ok', true);
end $$;

-- the agreement as it stands today, for the sign-up page (name/phone are filled in live there)
create or replace function team_agreement() returns jsonb
language sql security definer set search_path = public stable as $$
  select jsonb_build_object(
    'rate', (select value::numeric from team_config where key = 'commission_rate'),
    'days', (select value::int from team_config where key = 'payout_days'),
    'text', team_agreement_render('agreement', '{name}', '{phone}'),
    'text_en', team_agreement_render('agreement_en', '{name}', '{phone}'))
$$;

-- the client's own form, reached through an ambassador's link
create or replace function team_ref_info(p_code text) returns jsonb
language sql security definer set search_path = public stable as $$
  select coalesce((select jsonb_build_object('first', split_part(full_name, ' ', 1))
                     from team_members where code = upper(p_code) and status <> 'suspended'),
                  jsonb_build_object('error','code'))
$$;

create or replace function team_ref_submit(p_code text, p_name text, p_company text, p_phone text,
  p_city text, p_service text, p_notes text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from team_members where code = upper(p_code) and status <> 'suspended';
  if v is null then return jsonb_build_object('error','code'); end if;
  if p_phone !~ '^05[0-9]{8}$' then return jsonb_build_object('error','phone'); end if;
  if char_length(trim(coalesce(p_name,''))) < 2 then return jsonb_build_object('error','name'); end if;
  if not team_throttle('ref:' || p_phone, 1, interval '1 day')
     or not team_throttle('refcode:' || v, 60, interval '1 day') then
    return jsonb_build_object('error','too_many');
  end if;
  insert into team_attempts(key) values ('ref:' || p_phone), ('refcode:' || v);
  perform team_insert_lead(v, 'link', p_name, p_company, p_phone, p_city, p_service, p_notes);
  return jsonb_build_object('ok', true);   -- a client never learns whether someone else registered him first
end $$;

-- ---------- operator ----------

create or replace function team_admin(p_secret text, p_action text, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_old team_leads;
begin
  if not team_is_admin(p_secret) then return jsonb_build_object('error','auth'); end if;

  if p_action = 'list' then
    return jsonb_build_object(
      'members', coalesce((select jsonb_agg(jsonb_build_object(
          'id', m.id, 'code', m.code, 'name', m.full_name, 'phone', m.phone, 'city', m.city,
          'tiktok', m.tiktok, 'status', m.status, 'iban', m.iban, 'iban_name', m.iban_name,
          'bank', m.bank, 'created_at', m.created_at, 'agreed_rate', m.agreed_rate, 'agreed_at', m.terms_at)
          order by m.created_at) from team_members m), '[]'::jsonb),
      'leads', coalesce((select jsonb_agg(jsonb_build_object(
          'id', l.id, 'member_id', l.member_id, 'client_name', l.client_name, 'company', l.company,
          'client_phone', l.client_phone, 'city', l.city, 'service', l.service, 'notes', l.notes,
          'source', l.source, 'status', l.status, 'deal_value', l.deal_value, 'commission', l.commission,
          'paid_at', l.paid_at, 'paid_ref', l.paid_ref, 'admin_note', l.admin_note,
          'created_at', l.created_at,
          'quote', (select to_jsonb(q) - 'lead_id' from team_quotes q where q.lead_id = l.id))
          order by l.created_at desc) from team_leads l), '[]'::jsonb));
  end if;

  if p_action = 'lead' then
    v_id := (p->>'id')::uuid;
    select * into v_old from team_leads where id = v_id;
    if v_old.id is null then return jsonb_build_object('error','not_found'); end if;
    update team_leads set
      status     = coalesce(p->>'status', status),
      deal_value = case when p ? 'deal_value' then nullif(p->>'deal_value','')::numeric else deal_value end,
      commission = case when p ? 'commission' then nullif(p->>'commission','')::numeric else commission end,
      admin_note = case when p ? 'admin_note' then nullif(p->>'admin_note','') else admin_note end,
      updated_at = now()
    where id = v_id;
    insert into team_lead_events(lead_id, actor, action, detail) values (v_id, 'admin', 'update', p - 'id');
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'paid' then
    v_id := (p->>'id')::uuid;
    update team_leads set paid_at = case when coalesce((p->>'undo')::boolean,false) then null else now() end,
                          paid_ref = case when coalesce((p->>'undo')::boolean,false) then null else nullif(p->>'ref','') end,
                          updated_at = now()
     where id = v_id and status = 'won';
    if not found then return jsonb_build_object('error','not_won'); end if;
    insert into team_lead_events(lead_id, actor, action, detail) values (v_id, 'admin', 'paid', p - 'id');
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'quote_send' then
    return team_quote_send(p);
  end if;

  if p_action = 'quote_terms' then
    if p ? 'terms' then
      if char_length(coalesce(p->>'terms','')) not between 10 and 8000 then return jsonb_build_object('error','terms_short'); end if;
      update team_config set value = p->>'terms' where key = 'quote_terms';
    end if;
    if p ? 'terms_en' then
      if char_length(coalesce(p->>'terms_en','')) not between 10 and 8000 then return jsonb_build_object('error','terms_short'); end if;
      update team_config set value = p->>'terms_en' where key = 'quote_terms_en';
    end if;
    return jsonb_build_object('ok', true, 'terms', (select value from team_config where key = 'quote_terms'),
                              'terms_en', (select value from team_config where key = 'quote_terms_en'));
  end if;

  if p_action = 'agreement' then
    if p ? 'rate' then
      if (p->>'rate')::numeric not between 0 and 100 then return jsonb_build_object('error','rate'); end if;
      update team_config set value = (p->>'rate') where key = 'commission_rate';
    end if;
    if p ? 'days' then
      if (p->>'days')::int not between 1 and 120 then return jsonb_build_object('error','rate'); end if;
      update team_config set value = (p->>'days') where key = 'payout_days';
    end if;
    if p ? 'text' then
      if char_length(coalesce(p->>'text','')) not between 50 and 12000 then return jsonb_build_object('error','terms_short'); end if;
      update team_config set value = p->>'text' where key = 'agreement';
    end if;
    if p ? 'text_en' then
      if char_length(coalesce(p->>'text_en','')) not between 50 and 12000 then return jsonb_build_object('error','terms_short'); end if;
      update team_config set value = p->>'text_en' where key = 'agreement_en';
    end if;
    return jsonb_build_object('ok', true,
      'rate', (select value::numeric from team_config where key = 'commission_rate'),
      'days', (select value::int from team_config where key = 'payout_days'),
      'text', (select value from team_config where key = 'agreement'),
      'text_en', (select value from team_config where key = 'agreement_en'));
  end if;

  if p_action = 'catalog' then
    if p ? 'catalog' then
      if jsonb_typeof(p->'catalog') <> 'array' or jsonb_array_length(p->'catalog') > 40
         or exists (select 1 from jsonb_array_elements(p->'catalog') e
                    where coalesce(e->>'id','') !~ '^[a-z0-9_]{1,30}$' or coalesce(trim(e->>'ar'),'') = ''
                       or (e->>'price' is not null and (e->>'price')::numeric < 0)) then
        return jsonb_build_object('error','catalog');
      end if;
      update team_config set value = (p->'catalog')::text where key = 'catalog';
    end if;
    return jsonb_build_object('ok', true, 'catalog', (select value::jsonb from team_config where key = 'catalog'));
  end if;

  if p_action = 'member' then
    update team_members set status = p->>'status' where id = (p->>'id')::uuid;
    if (p->>'status') = 'suspended' then delete from team_sessions where member_id = (p->>'id')::uuid; end if;
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'events' then
    return coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'actor', e.actor, 'action', e.action,
             'detail', e.detail) order by e.at) from team_lead_events e where e.lead_id = (p->>'id')::uuid), '[]'::jsonb);
  end if;

  return jsonb_build_object('error','action');
end $$;

-- A new function is EXECUTE-able by PUBLIC, and Supabase grants anon/authenticated on top.
-- Only the API above is meant for the browser; grant it explicitly, and nothing else.
grant execute on function team_register(text,text,text,text,text,boolean)            to anon, authenticated;
grant execute on function team_login(text,text)                                       to anon, authenticated;
grant execute on function team_logout(text)                                           to anon, authenticated;
grant execute on function team_me(text)                                               to anon, authenticated;
grant execute on function team_add_lead(text,text,text,text,text,text,text)           to anon, authenticated;
grant execute on function team_set_iban(text,text,text,text)                          to anon, authenticated;
grant execute on function team_ref_info(text)                                         to anon, authenticated;
grant execute on function team_agreement()                                            to anon, authenticated;
grant execute on function team_ref_submit(text,text,text,text,text,text,text)         to anon, authenticated;
grant execute on function team_admin(text,text,jsonb)                                 to anon, authenticated;

-- Check after any change — all must be false:
--   select has_table_privilege('anon','public.team_members','SELECT'),
--          has_function_privilege('anon','public.team_insert_lead(uuid,text,text,text,text,text,text,text)','EXECUTE'),
--          has_function_privilege('anon','public.team_is_admin(text)','EXECUTE');

-- ============================================================
--  المهمة الشهرية — monthly engagement task
--
--  The operator posts his TikTok video links. Each ambassador opens one,
--  engages, and marks it done WITH THE TEXT OF HER COMMENT. TikTok exposes
--  no way to learn who liked or shared a video, so the comment is the only
--  part anyone can check: the operator finds it under her TikTok handle and
--  rejects a mark he cannot find. Whoever has an accepted mark on every
--  video of a calendar month (Riyadh time) is due the monthly bonus
--  (team_config.monthly_bonus, default 150). Paying is recorded per member
--  per month, so it can never be paid twice.
-- ============================================================

create table if not exists team_posts (
  id          uuid primary key default gen_random_uuid(),
  url         text not null,
  title       text,
  created_at  timestamptz not null default now(),
  constraint team_p_url   check (url ~ '^https://' and char_length(url) <= 300),
  constraint team_p_title check (title is null or char_length(title) <= 80)
);

create table if not exists team_post_done (
  post_id    uuid not null references team_posts(id) on delete cascade,
  member_id  uuid not null references team_members(id) on delete cascade,
  comment    text not null,
  done_at    timestamptz not null default now(),
  rejected   boolean not null default false,
  primary key (post_id, member_id),
  constraint team_d_comment check (char_length(comment) between 2 and 300)
);

create table if not exists team_bonuses (
  member_id  uuid not null references team_members(id) on delete cascade,
  month      date not null,                       -- first day of the month
  amount     numeric(12,2) not null,
  paid_at    timestamptz not null default now(),
  paid_ref   text,
  primary key (member_id, month)
);

insert into team_config(key, value) values ('monthly_bonus', '150') on conflict (key) do nothing;

alter table team_posts     enable row level security;
alter table team_post_done enable row level security;
alter table team_bonuses   enable row level security;
revoke all on team_posts, team_post_done, team_bonuses from public, anon, authenticated;

create or replace function team_month_of(t timestamptz) returns date
language sql immutable as $$ select date_trunc('month', t at time zone 'Asia/Riyadh')::date $$;
revoke all on function team_month_of(timestamptz) from public, anon, authenticated;

-- what the ambassador sees: this month's and last month's videos, her marks, her bonuses
create or replace function team_tasks(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := team_member_of(p_token);
begin
  if v is null then return jsonb_build_object('error','auth'); end if;
  return jsonb_build_object(
    'bonus', (select value::numeric from team_config where key = 'monthly_bonus'),
    'this_month', team_month_of(now()),
    'posts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'url', p.url, 'title', p.title, 'created_at', p.created_at,
        'month', team_month_of(p.created_at),
        'done', d.post_id is not null, 'rejected', coalesce(d.rejected, false), 'comment', d.comment)
        order by p.created_at desc)
      from team_posts p left join team_post_done d on d.post_id = p.id and d.member_id = v
      where team_month_of(p.created_at) >= (team_month_of(now()) - interval '1 month')::date), '[]'::jsonb),
    'bonuses', coalesce((select jsonb_agg(jsonb_build_object('month', b.month, 'amount', b.amount,
        'paid_at', b.paid_at, 'paid_ref', b.paid_ref) order by b.month desc)
      from team_bonuses b where b.member_id = v), '[]'::jsonb));
end $$;

create or replace function team_task_done(p_token text, p_post uuid, p_comment text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := team_member_of(p_token); m date;
begin
  if v is null then return jsonb_build_object('error','auth'); end if;
  if char_length(trim(coalesce(p_comment,''))) < 2 then return jsonb_build_object('error','comment'); end if;
  select team_month_of(created_at) into m from team_posts where id = p_post;
  if m is null then return jsonb_build_object('error','not_found'); end if;
  if m < team_month_of(now()) then return jsonb_build_object('error','closed'); end if;   -- last month is closed
  insert into team_post_done(post_id, member_id, comment) values (p_post, v, left(trim(p_comment), 300))
  on conflict (post_id, member_id) do update
    set comment = excluded.comment, done_at = now()
    where not team_post_done.rejected;       -- a rejected mark stays rejected until the operator lifts it
  if not found then return jsonb_build_object('error','rejected'); end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function team_task_admin(p_secret text, p_action text, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_month date := coalesce((p->>'month')::date, team_month_of(now())); v_bonus numeric;
begin
  if not team_is_admin(p_secret) then return jsonb_build_object('error','auth'); end if;
  select value::numeric into v_bonus from team_config where key = 'monthly_bonus';

  if p_action = 'list' then
    return jsonb_build_object(
      'bonus', v_bonus, 'month', v_month,
      'posts', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'url', url, 'title', title, 'created_at', created_at)
                 order by created_at desc) from team_posts where team_month_of(created_at) = v_month), '[]'::jsonb),
      'done', coalesce((select jsonb_agg(jsonb_build_object('post_id', d.post_id, 'member_id', d.member_id,
                 'comment', d.comment, 'done_at', d.done_at, 'rejected', d.rejected))
               from team_post_done d join team_posts p on p.id = d.post_id
               where team_month_of(p.created_at) = v_month), '[]'::jsonb),
      'paid', coalesce((select jsonb_agg(jsonb_build_object('member_id', member_id, 'amount', amount,
                 'paid_at', paid_at, 'paid_ref', paid_ref)) from team_bonuses where month = v_month), '[]'::jsonb));
  end if;

  if p_action = 'post_add' then
    insert into team_posts(url, title) values (trim(p->>'url'), nullif(trim(p->>'title'),''));
    return jsonb_build_object('ok', true);
  end if;
  if p_action = 'post_del' then
    delete from team_posts where id = (p->>'id')::uuid;
    return jsonb_build_object('ok', true);
  end if;
  if p_action = 'reject' then
    update team_post_done set rejected = not coalesce((p->>'undo')::boolean, false)
     where post_id = (p->>'post_id')::uuid and member_id = (p->>'member_id')::uuid;
    return jsonb_build_object('ok', true);
  end if;
  if p_action = 'set_bonus' then
    update team_config set value = ((p->>'amount')::numeric)::text where key = 'monthly_bonus';
    return jsonb_build_object('ok', true);
  end if;
  if p_action = 'pay' then
    insert into team_bonuses(member_id, month, amount, paid_ref)
    values ((p->>'member_id')::uuid, v_month, coalesce((p->>'amount')::numeric, v_bonus), nullif(p->>'ref',''))
    on conflict (member_id, month) do nothing;
    if not found then return jsonb_build_object('error','already'); end if;
    return jsonb_build_object('ok', true);
  end if;
  if p_action = 'unpay' then
    delete from team_bonuses where member_id = (p->>'member_id')::uuid and month = v_month;
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object('error','action');
end $$;

grant execute on function team_tasks(text)                       to anon, authenticated;
grant execute on function team_task_done(text,uuid,text)         to anon, authenticated;
grant execute on function team_task_admin(text,text,jsonb)       to anon, authenticated;

-- ============================================================
--  عروض الأسعار — quotes
--
--  An ambassador asks for a quote on one of her own leads, with the
--  client's requirements. The operator prices it line by line; the total
--  (and 15% VAT when ticked) is computed HERE, never trusted from the page.
--  The quote then has its own page (/team#/q/<id>) that the ambassador
--  sends the client. Acceptance is recorded either by the ambassador or —
--  stronger evidence — by the client pressing «أوافق» on that page
--  (decided_by = 'client'). Accepting does not mark the lead won: the
--  operator still signs the contract and sets «تم التعاقد» himself.
--  One quote per lead; asking again re-opens it until it is accepted.
-- ============================================================

create table if not exists team_quotes (
  id             uuid primary key default gen_random_uuid(),
  no             serial,
  lead_id        uuid not null unique references team_leads(id) on delete cascade,
  details        text not null,
  status         text not null default 'requested',     -- requested | sent | accepted | declined
  items          jsonb,                                  -- [{d, q, p}]
  vat            boolean not null default true,
  subtotal       numeric(12,2),
  total          numeric(12,2),
  valid_until    date,
  note           text,
  requested_at   timestamptz not null default now(),
  sent_at        timestamptz,
  decided_at     timestamptz,
  decided_by     text,                                   -- member | client
  decision_note  text,
  constraint team_q_details check (char_length(details) between 3 and 1000),
  constraint team_q_status  check (status in ('requested','sent','accepted','declined')),
  constraint team_q_note    check (note is null or char_length(note) <= 1000),
  constraint team_q_dnote   check (decision_note is null or char_length(decision_note) <= 300),
  constraint team_q_by      check (decided_by is null or decided_by in ('member','client'))
);
alter table team_quotes enable row level security;
revoke all on team_quotes from public, anon, authenticated;
revoke all on sequence team_quotes_no_seq from public, anon, authenticated;

-- the fuller quote layout: billing cycle, the client's address and VAT number,
-- and the terms SNAPSHOT — copied from team_config at send time, so editing the
-- default terms later never rewrites a quote a client has already seen.
alter table team_quotes add column if not exists plan text
  check (plan is null or plan in ('once','monthly','yearly'));
alter table team_quotes add column if not exists client_address text
  check (client_address is null or char_length(client_address) <= 300);
alter table team_quotes add column if not exists client_vat text
  check (client_vat is null or client_vat ~ '^[0-9]{15}$');
alter table team_quotes add column if not exists terms text
  check (terms is null or char_length(terms) <= 8000);

-- default terms: "## " starts a numbered section, "- " a bullet. Editable from
-- the operator's dashboard (team_admin('quote_terms')). Keep in step with
-- DEFAULT_TERMS in team.html, which the demo uses.
insert into team_config(key, value) values ('quote_terms', $terms$## بدء الخدمة وتجديدها
- تُحتسب مدة الاشتراك من تاريخ أول تشغيل فعلي للنظام وإبلاغ العميل بذلك، ولا تدخل فترة التركيب والتهيئة ضمن مدة الاشتراك.
- يتجدد الاشتراك تلقائياً لمدة مساوية، إلا إذا أبلغ أحد الطرفين الطرف الآخر كتابياً بعدم رغبته في التجديد قبل (30) يوماً على الأقل من انتهاء المدة الجارية.
## التزامات رفد
- تشغيل الخدمة وربطها تقنياً بكاميرات العميل وأجهزة التسجيل (NVR) وأنظمة التذاكر المعتمدة، مع التدريب والدعم الفني دون مقابل إضافي طوال مدة الاشتراك.
- الالتزام بنظام حماية البيانات الشخصية في المملكة العربية السعودية، بحيث تُعالج البيانات لحظياً وبشكل مشفّر، ولا تُحفظ أي بيانات شخصية أو صور للأفراد على الأجهزة الطرفية.
- حذف جميع بيانات العميل خلال (5) أيام عمل من انتهاء الاشتراك أو إلغائه، وتزويد العميل بما يثبت ذلك كتابياً.
## التزامات العميل
- تسهيل وصول فريق رفد إلى المواقع والأنظمة اللازمة لإكمال أعمال الربط والتركيب.
- يُقرّ العميل بأن أجهزة الحوسبة الطرفية المركّبة في مواقعه مملوكة لرفد، ويتعهد بالمحافظة عليها كما يحافظ على ممتلكاته.
## إنهاء الاشتراك
- إذا أخلّ أحد الطرفين بأي من التزاماته يُبلَّغ كتابياً ويُمنح (5) أيام لتصحيح الإخلال، فإن لم يُصحَّح جاز للطرف الآخر إنهاء الاشتراك فوراً.
- لكل طرف إنهاء الاشتراك بإشعار كتابي قبل (30) يوماً من التاريخ المحدد للإنهاء، ويسدد العميل قيمة الخدمة المقدَّمة حتى ذلك التاريخ، ويعيد أجهزة الحوسبة الطرفية المملوكة لرفد دون تأخير.
## أحكام عامة
- لا يُسأل أي طرف عن التأخير الناتج عن قوة قاهرة أو ظروف خارجة عن إرادته، كالقرارات الحكومية والأوبئة، بشرط ألا يتجاوز ذلك (30) يوماً من تاريخ إبلاغ الطرف الآخر.
- تسري على هذا العرض وما ينتج عنه أنظمة المملكة العربية السعودية، وتكون محاكم مدينة الرياض وحدها المختصة بالنظر في أي خلاف.$terms$)
on conflict (key) do nothing;

-- bilingual quotes: the language a quote opens in, the English terms snapshot,
-- and what the ambassador picked from the catalogue when she asked for it.
alter table team_quotes add column if not exists lang text not null default 'ar' check (lang in ('ar','en'));
alter table team_quotes add column if not exists terms_en text check (terms_en is null or char_length(terms_en) <= 8000);
alter table team_quotes add column if not exists requested_items jsonb;
-- a request may now be the picked packages alone, with no free text
alter table team_quotes drop constraint if exists team_q_details;
alter table team_quotes add constraint team_q_details check (char_length(details) between 1 and 1000);

insert into team_config(key, value) values ('quote_terms_en', $terms$## Service start and renewal
- The subscription term starts on the date the system is first put into actual operation and the client is notified; the installation and setup period is not counted as part of the term.
- The subscription renews automatically for an equal term unless either party notifies the other in writing, at least (30) days before the current term ends, that it does not wish to renew.
## RAFD's obligations
- To operate the service and integrate it technically with the client's cameras, recording devices (NVR) and approved ticketing systems, including training and technical support at no extra charge throughout the subscription.
- To comply with the Personal Data Protection Law of the Kingdom of Saudi Arabia, processing data in real time and in encrypted form, with no personal data or images of individuals stored on edge devices.
- To delete all client data within (5) working days of the subscription ending or being cancelled, and to confirm this to the client in writing.
## Client's obligations
- To give RAFD's team access to the sites and systems needed to complete the integration and installation work.
- The client acknowledges that the edge computing devices installed at its sites are owned by RAFD and undertakes to look after them as it would its own property.
## Termination
- If either party breaches any of its obligations, it shall be notified in writing and given (5) days to remedy the breach; if the breach is not remedied, the other party may terminate the subscription immediately.
- Either party may terminate the subscription by written notice at least (30) days before the intended termination date. The client shall pay for the service provided up to that date and return RAFD's edge computing devices without delay.
## General provisions
- Neither party is liable for delay caused by force majeure or circumstances beyond its control, such as government decisions or epidemics, provided this does not exceed (30) days from notifying the other party.
- This quotation and anything arising from it are governed by the laws of the Kingdom of Saudi Arabia, and the courts of Riyadh shall have exclusive jurisdiction over any dispute.$terms$)
on conflict (key) do nothing;

-- the product catalogue the ambassador picks from and the operator prices from.
-- price null = priced per quote. Edited from the dashboard (team_admin('catalog')).
-- Keep in step with DEFAULT_CATALOG in team.html, which the demo uses.
insert into team_config(key, value) values ('catalog', $cat$[
 {"id":"basic","ar":"الباقة الأساسية","en":"Basic Package","desc_ar":"اشتراك في منصة رفد بالمزايا الأساسية لفرع واحد","desc_en":"RAFD platform subscription with core features for one branch","unit_ar":"فرع","unit_en":"branch","price":null},
 {"id":"pro","ar":"الباقة الاحترافية (برو)","en":"Pro Package","desc_ar":"اشتراك في منصة رفد بكامل المزايا والتقارير المتقدمة لفرع واحد","desc_en":"RAFD platform subscription with all features and advanced reports for one branch","unit_ar":"فرع","unit_en":"branch","price":null},
 {"id":"face","ar":"التعرف على الوجه (بصمة الوجه)","en":"Face Recognition Attendance","desc_ar":"تسجيل الحضور والانصراف بالتعرف على الوجه","desc_en":"Check-in and check-out by face recognition","unit_ar":"فرع","unit_en":"branch","price":null},
 {"id":"face_cam","ar":"كاميرا التعرف على الوجه","en":"Face Recognition Camera","desc_ar":"كاميرا مخصصة للتعرف على الوجه شاملة التركيب","desc_en":"Dedicated face recognition camera, installation included","unit_ar":"كاميرا","unit_en":"camera","price":null},
 {"id":"activation","ar":"رسوم التفعيل","en":"Activation Fee","desc_ar":"تهيئة الخدمة وربطها لفرع واحد","desc_en":"Service setup and integration for one branch","unit_ar":"فرع","unit_en":"branch","price":null}
]$cat$)
on conflict (key) do nothing;

-- the 3-argument version is DROPPED, not left beside this one: a defaulted
-- extra argument would make a 3-argument call ambiguous (see CLAUDE.md).
drop function if exists team_quote_request(text,uuid,text);
create or replace function team_quote_request(p_token text, p_lead uuid, p_details text, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := team_member_of(p_token); l team_leads; q team_quotes;
begin
  if v is null then return jsonb_build_object('error','auth'); end if;
  if char_length(trim(coalesce(p_details,''))) < 3
     and (p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0) then
    return jsonb_build_object('error','details');
  end if;
  if p_items is not null and (jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 20
     or exists (select 1 from jsonb_array_elements(p_items) e
                where coalesce(e->>'id','') !~ '^[a-z0-9_]{1,30}$' or coalesce((e->>'q')::numeric, 0) <= 0)) then
    return jsonb_build_object('error','items');
  end if;
  select * into l from team_leads where id = p_lead and member_id = v;
  if l.id is null then return jsonb_build_object('error','not_found'); end if;
  if l.status in ('duplicate','lost','won') then return jsonb_build_object('error','lead_closed'); end if;
  select * into q from team_quotes where lead_id = p_lead;
  if q.status = 'accepted' then return jsonb_build_object('error','accepted'); end if;
  insert into team_quotes(lead_id, details, requested_items)
  values (p_lead, coalesce(nullif(left(trim(coalesce(p_details,'')), 1000), ''), '—'), p_items)
  on conflict (lead_id) do update set details = excluded.details, requested_items = excluded.requested_items,
    status = 'requested', items = null,
    subtotal = null, total = null, valid_until = null, note = null, requested_at = now(),
    sent_at = null, decided_at = null, decided_by = null, decision_note = null;
  insert into team_lead_events(lead_id, actor, action, detail) values (p_lead, 'member', 'quote_request', null);
  return jsonb_build_object('ok', true);
end $$;

create or replace function team_quote_decide(p_token text, p_lead uuid, p_accept boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := team_member_of(p_token);
begin
  if v is null then return jsonb_build_object('error','auth'); end if;
  update team_quotes q set status = case when p_accept then 'accepted' else 'declined' end,
         decided_at = now(), decided_by = 'member', decision_note = nullif(left(trim(coalesce(p_note,'')), 300), '')
   where q.lead_id = p_lead and q.status = 'sent'
     and exists (select 1 from team_leads l where l.id = p_lead and l.member_id = v);
  if not found then return jsonb_build_object('error','not_sent'); end if;
  insert into team_lead_events(lead_id, actor, action, detail)
    values (p_lead, 'member', case when p_accept then 'quote_accepted' else 'quote_declined' end, null);
  return jsonb_build_object('ok', true);
end $$;

-- the client's quote page: no ambassador, no phone, no commission on it
create or replace function team_quote_public(p_id uuid) returns jsonb
language sql security definer set search_path = public stable as $$
  select coalesce((select jsonb_build_object(
      'no', q.no, 'status', q.status, 'items', q.items, 'vat', q.vat, 'subtotal', q.subtotal,
      'total', q.total, 'valid_until', q.valid_until, 'note', q.note, 'sent_at', q.sent_at,
      'decided_at', q.decided_at, 'decided_by', q.decided_by,
      'plan', q.plan, 'client_address', q.client_address, 'client_vat', q.client_vat, 'terms', q.terms,
      'terms_en', q.terms_en, 'lang', q.lang,
      'client_name', l.client_name, 'company', l.company, 'city', l.city,
      'rep_name', m.full_name)
    from team_quotes q join team_leads l on l.id = q.lead_id join team_members m on m.id = l.member_id
    where q.id = p_id and q.status in ('sent','accepted','declined')),
    jsonb_build_object('error','not_found'))
$$;

create or replace function team_quote_client_accept(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_lead uuid;
begin
  update team_quotes set status = 'accepted', decided_at = now(), decided_by = 'client'
   where id = p_id and status = 'sent' and (valid_until is null or valid_until >= (now() at time zone 'Asia/Riyadh')::date)
  returning lead_id into v_lead;
  if v_lead is null then return jsonb_build_object('error','not_open'); end if;
  insert into team_lead_events(lead_id, actor, action, detail) values (v_lead, 'client', 'quote_accepted', null);
  return jsonb_build_object('ok', true);
end $$;

-- internal: called by team_admin('quote_send'). Prices every line and sums it here.
create or replace function team_quote_send(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_lead uuid := (p->>'lead_id')::uuid; v_items jsonb := '[]'::jsonb; it jsonb;
        v_sub numeric := 0; v_vat boolean := coalesce((p->>'vat')::boolean, true); q numeric; pr numeric;
begin
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 or jsonb_array_length(p->'items') > 40 then
    return jsonb_build_object('error','items');
  end if;
  if regexp_replace(coalesce(p->>'client_vat',''), '\D', '', 'g') !~ '^([0-9]{15})?$' then
    return jsonb_build_object('error','client_vat');
  end if;
  for it in select * from jsonb_array_elements(p->'items') loop
    q := (it->>'q')::numeric; pr := (it->>'p')::numeric;
    if coalesce(trim(it->>'d'),'') = '' or q is null or q <= 0 or pr is null or pr < 0 then
      return jsonb_build_object('error','items');
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object('d', left(trim(it->>'d'), 200), 'q', q, 'p', pr,
                 'n', nullif(left(trim(coalesce(it->>'n','')), 300), ''), 'u', nullif(left(trim(coalesce(it->>'u','')), 20), ''),
                 'd_en', nullif(left(trim(coalesce(it->>'d_en','')), 200), ''), 'n_en', nullif(left(trim(coalesce(it->>'n_en','')), 300), ''),
                 'u_en', nullif(left(trim(coalesce(it->>'u_en','')), 20), '')));
    v_sub := v_sub + q * pr;
  end loop;
  update team_quotes set items = v_items, vat = v_vat, subtotal = round(v_sub, 2),
         total = round(v_sub * case when v_vat then 1.15 else 1 end, 2),
         valid_until = nullif(p->>'valid_until','')::date, note = nullif(left(trim(coalesce(p->>'note','')), 1000), ''),
         status = 'sent', sent_at = now(), decided_at = null, decided_by = null, decision_note = null,
         plan = nullif(p->>'plan',''), client_address = nullif(left(trim(coalesce(p->>'client_address','')), 300), ''),
         client_vat = nullif(regexp_replace(coalesce(p->>'client_vat',''), '\D', '', 'g'), ''),
         terms = (select value from team_config where key = 'quote_terms'),
         terms_en = (select value from team_config where key = 'quote_terms_en'),
         lang = case when p->>'lang' = 'en' then 'en' else 'ar' end
   where lead_id = v_lead and status in ('requested','sent','declined');
  if not found then return jsonb_build_object('error','not_found'); end if;
  insert into team_lead_events(lead_id, actor, action, detail) values (v_lead, 'admin', 'quote_sent', jsonb_build_object('total', round(v_sub, 2)));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function team_quote_send(jsonb) from public, anon, authenticated;

grant execute on function team_quote_request(text,uuid,text,jsonb)      to anon, authenticated;
grant execute on function team_quote_decide(text,uuid,boolean,text)     to anon, authenticated;
grant execute on function team_quote_public(uuid)                       to anon, authenticated;
grant execute on function team_quote_client_accept(uuid)                to anon, authenticated;
