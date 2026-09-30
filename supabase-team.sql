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
  insert into team_members(code, full_name, phone, city, tiktok, pass_hash)
  values (v_code, trim(p_name), p_phone, nullif(trim(p_city),''), nullif(trim(p_tiktok),''),
          crypt(p_password, gen_salt('bf')))
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
      'iban_name', m.iban_name, 'bank', m.bank, 'iban_at', m.iban_at),
    'leads', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'client_name', l.client_name, 'company', l.company,
        'client_phone', l.client_phone, 'city', l.city, 'service', l.service, 'notes', l.notes,
        'source', l.source, 'status', l.status, 'deal_value', l.deal_value,
        'commission', l.commission, 'paid_at', l.paid_at, 'paid_ref', l.paid_ref,
        'created_at', l.created_at, 'updated_at', l.updated_at) order by l.created_at desc)
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
          'bank', m.bank, 'created_at', m.created_at) order by m.created_at) from team_members m), '[]'::jsonb),
      'leads', coalesce((select jsonb_agg(jsonb_build_object(
          'id', l.id, 'member_id', l.member_id, 'client_name', l.client_name, 'company', l.company,
          'client_phone', l.client_phone, 'city', l.city, 'service', l.service, 'notes', l.notes,
          'source', l.source, 'status', l.status, 'deal_value', l.deal_value, 'commission', l.commission,
          'paid_at', l.paid_at, 'paid_ref', l.paid_ref, 'admin_note', l.admin_note,
          'created_at', l.created_at) order by l.created_at desc) from team_leads l), '[]'::jsonb));
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
