-- ============================================================
--  مزاد الأرقام  —  Phone-number auction (mazad.html)
--  Run this ONCE in the Supabase SQL editor.
--
--  Design notes
--  ------------
--  * The browser talks to Supabase directly with the ANON key
--    (no serverless function — api/ is already at Vercel's
--    12-function Hobby limit).
--  * Therefore NOTHING is trusted from the client:
--      - listings  : anon may INSERT (validated by CHECKs) + SELECT
--      - bids      : anon may SELECT only. Bids are placed through
--                    the place_bid() RPC, which enforces the rules.
--      - no UPDATE / DELETE is granted to anon at all.
--  * Closing / deleting a listing goes through mazad_admin(),
--    which checks a secret stored in mazad_config (unreadable by anon).
-- ============================================================

-- ---------- tables ----------

create table if not exists mazad_listings (
  id             uuid primary key default gen_random_uuid(),
  phone          text        not null,
  carrier        text,                       -- stc | mobily | zain | other
  start_price    numeric(12,2) not null default 0,
  seller_name    text        not null,
  seller_contact text,                       -- whatsapp / phone to close the deal
  note           text,
  end_at         timestamptz,          -- null until the operator opens the bidding
  status         text        not null default 'pending',   -- open | sold | cancelled
  created_at     timestamptz not null default now(),

  constraint mazad_phone_format    check (phone ~ '^05[0-9]{8}$'),
  constraint mazad_price_range     check (start_price >= 0 and start_price <= 100000000),
  constraint mazad_seller_len      check (char_length(seller_name) between 2 and 40),
  constraint mazad_contact_len     check (seller_contact is null or char_length(seller_contact) <= 40),
  constraint mazad_note_len        check (note is null or char_length(note) <= 200),
  constraint mazad_status_values   check (status in ('pending','open','sold','unsold','cancelled'))
);

-- live-broadcast mode: which number is on air right now
alter table mazad_listings add column if not exists is_live boolean not null default false;
-- a number can be sold at a price agreed off the site (on the broadcast, over
-- WhatsApp). Record that price rather than inventing bids to represent it.
alter table mazad_listings add column if not exists sold_price numeric(12,2);
alter table mazad_listings alter column end_at drop not null;
alter table mazad_listings drop constraint if exists mazad_sold_price_range;
alter table mazad_listings add  constraint mazad_sold_price_range
  check (sold_price is null or (sold_price >= 0 and sold_price <= 100000000));
alter table mazad_listings drop constraint if exists mazad_status_values;
alter table mazad_listings add  constraint mazad_status_values
  check (status in ('pending','open','sold','unsold','cancelled'));

create table if not exists mazad_bids (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references mazad_listings(id) on delete cascade,
  bidder_name text not null,
  amount      numeric(12,2) not null,
  created_at  timestamptz not null default now()
);

-- a sum sent from the site waits for the operator before it counts
alter table mazad_bids add column if not exists approved    boolean not null default false;
alter table mazad_bids add column if not exists approved_at timestamptz;
create index if not exists mazad_bids_pending_idx on mazad_bids (listing_id, created_at) where not approved;

create index if not exists mazad_bids_listing_idx  on mazad_bids (listing_id, created_at);
create index if not exists mazad_listings_end_idx  on mazad_listings (status, end_at desc);
create index if not exists mazad_listings_live_idx on mazad_listings (is_live) where is_live;

-- operator secret + settings (never readable by anon)
create table if not exists mazad_config (
  key   text primary key,
  value text not null
);

-- CHANGE THIS SECRET before you share the site.
insert into mazad_config (key, value)
values ('admin_secret', 'change-me-now')
on conflict (key) do nothing;

-- ---------- table privileges ----------
-- Supabase grants new public tables to anon by default. Narrow that down to
-- exactly what the page needs: read listings + bids, create a listing.
-- No UPDATE/DELETE grant at all — closing or editing goes through the
-- SECURITY DEFINER functions below.

revoke all on mazad_listings from anon, authenticated;
revoke all on mazad_bids     from anon, authenticated;
revoke all on mazad_config   from anon, authenticated;

-- the public reads the masked VIEW below, never the listings table itself
grant insert on mazad_listings to anon, authenticated;
grant select on mazad_bids     to anon, authenticated;

-- ---------- what the public may read ----------
-- A number waiting its turn must not be readable in full, or a viewer can take
-- it and negotiate with the seller outside the auction. Masking it in the page
-- is not enough — the full number would still travel to the browser. So the
-- public reads this view, and seller_contact is absent from it entirely.

create or replace view mazad_public as
select
  l.id,
  case
    when l.status = 'pending' and not l.is_live
      then left(l.phone, 3) || '•••••' || right(l.phone, 2)
    else l.phone
  end                                      as phone,
  (l.status = 'pending' and not l.is_live) as phone_masked,
  l.carrier, l.start_price, l.seller_name, l.note,
  l.end_at, l.status, l.is_live, l.sold_price, l.created_at
from mazad_listings l;

alter view mazad_public set (security_invoker = off);
grant select on mazad_public to anon, authenticated;

-- the operator gets the real rows, through the secret
create or replace function mazad_admin_list(p_secret text)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_secret text;
begin
  select value into v_secret from mazad_config where key = 'admin_secret';
  if v_secret is null or p_secret is null or p_secret <> v_secret then
    return json_build_object('ok', false, 'error', 'forbidden');
  end if;

  return json_build_object('ok', true, 'listings', coalesce((
    select json_agg(row_to_json(x) order by x.created_at desc)
      from (select l.*, false as phone_masked from mazad_listings l limit 300) x
  ), '[]'::json));
end;
$$;

revoke all on function mazad_admin_list(text) from public;
grant execute on function mazad_admin_list(text) to anon, authenticated;

-- ---------- row level security ----------

alter table mazad_listings enable row level security;
alter table mazad_bids     enable row level security;
alter table mazad_config   enable row level security;
-- mazad_config gets NO policies => no anon access at all.

drop policy if exists mazad_listings_read   on mazad_listings;
drop policy if exists mazad_listings_insert on mazad_listings;
drop policy if exists mazad_bids_read       on mazad_bids;

-- kept for the view and the SECURITY DEFINER functions; anon has no SELECT
-- privilege on this table at all (see the grants above)
create policy mazad_listings_read on mazad_listings
  for select to anon, authenticated using (true);

-- A seller registering a number does NOT start an auction. The number joins
-- the queue as 'pending' with no clock; only the operator opens the bidding
-- (mazad_admin 'timer') and only the operator can put it on air.
create policy mazad_listings_insert on mazad_listings
  for insert to anon, authenticated
  with check (
    status = 'pending'
    and end_at is null
    and is_live = false
    and sold_price is null
  );

-- the public only ever sees approved sums
create policy mazad_bids_read on mazad_bids
  for select to anon, authenticated using (approved);

-- no insert/update/delete policy on bids => only place_bid() can write them

-- ---------- placing a bid ----------
-- Enforces: auction exists, still open, not expired, bid beats the
-- current price by at least p_min_step, name is sane, and applies
-- anti-sniping (a bid in the last 60s pushes the end 2 minutes out).

create or replace function place_bid(
  p_listing uuid,
  p_name    text,
  p_amount  numeric
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing  mazad_listings%rowtype;
  v_current  numeric;
  v_step     numeric;
  v_new_end  timestamptz;
begin
  p_name := btrim(coalesce(p_name, ''));

  if char_length(p_name) < 2 or char_length(p_name) > 40 then
    return json_build_object('ok', false, 'error', 'bad_name');
  end if;

  select * into v_listing from mazad_listings where id = p_listing for update;
  if not found then
    return json_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_listing.status = 'pending' then
    return json_build_object('ok', false, 'error', 'not_started');
  end if;

  if v_listing.status <> 'open' then
    return json_build_object('ok', false, 'error', 'closed');
  end if;

  if v_listing.end_at is null or v_listing.end_at <= now() then
    return json_build_object('ok', false, 'error', 'expired');
  end if;

  -- the bar to clear is the highest APPROVED sum
  select coalesce(max(amount), v_listing.start_price)
    into v_current
    from mazad_bids where listing_id = p_listing and approved;

  -- minimum step: 50 up to 1,000 — then 5% of the current price
  v_step := greatest(50, ceil(v_current * 0.05));

  if p_amount is null or p_amount <= 0 or p_amount > 100000000 then
    return json_build_object('ok', false, 'error', 'bad_amount');
  end if;

  if p_amount < v_current + v_step then
    return json_build_object(
      'ok', false, 'error', 'too_low',
      'current', v_current, 'min', v_current + v_step
    );
  end if;

  -- one bid per name per 3 seconds (cheap spam brake)
  if exists (
    select 1 from mazad_bids
     where listing_id = p_listing
       and bidder_name = p_name
       and created_at > now() - interval '3 seconds'
  ) then
    return json_build_object('ok', false, 'error', 'too_fast');
  end if;

  -- at most three of one person's sums may be waiting at a time
  if (select count(*) from mazad_bids
       where listing_id = p_listing and bidder_name = p_name and not approved) >= 3 then
    return json_build_object('ok', false, 'error', 'too_many_pending');
  end if;

  insert into mazad_bids (listing_id, bidder_name, amount, approved)
  values (p_listing, p_name, p_amount, false);

  -- no anti-sniping here: the clock moves when the operator approves
  return json_build_object('ok', true, 'pending', true, 'amount', p_amount);
end;
$$;

revoke all on function place_bid(uuid, text, numeric) from public;
grant execute on function place_bid(uuid, text, numeric) to anon, authenticated;


-- ---------- operator actions ----------
-- p_action: sold | unsold | cancelled | open | extend | timer | price | live | unlive | next | delete
drop function if exists mazad_admin(uuid, text, text);
drop function if exists mazad_admin(uuid, text, text, int);

create or replace function mazad_admin(
  p_listing uuid,
  p_secret  text,
  p_action  text,
  p_minutes int     default null,
  p_price   numeric default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_next   uuid;
  v_final  numeric;
begin
  select value into v_secret from mazad_config where key = 'admin_secret';
  if v_secret is null or p_secret is null or p_secret <> v_secret then
    return json_build_object('ok', false, 'error', 'forbidden');
  end if;

  if p_action = 'delete' then
    delete from mazad_listings where id = p_listing;

  -- the result is stamped on the number, but it STAYS on air so the
  -- sticker is visible on the broadcast until the operator moves on
  elsif p_action = 'sold' then
    if p_price is not null and (p_price < 0 or p_price > 100000000) then
      return json_build_object('ok', false, 'error', 'bad_amount');
    end if;
    select coalesce(p_price,
                    (select max(amount) from mazad_bids where listing_id = p_listing),
                    l.start_price)
      into v_final
      from mazad_listings l where l.id = p_listing;
    update mazad_listings set status = 'sold', sold_price = v_final where id = p_listing;
    return json_build_object('ok', true, 'price', v_final);

  elsif p_action in ('unsold', 'cancelled') then
    update mazad_listings set status = p_action, sold_price = null where id = p_listing;

  elsif p_action = 'price' then
    update mazad_listings set sold_price = p_price where id = p_listing;

  -- send a finished number back to the queue
  elsif p_action = 'open' then
    update mazad_listings
       set status = 'pending', sold_price = null, end_at = null
     where id = p_listing;

  elsif p_action = 'extend' then
    update mazad_listings
       set end_at = greatest(coalesce(end_at, now()), now()) + (coalesce(p_minutes, 5) || ' minutes')::interval,
           status = 'open'
     where id = p_listing;

  -- THIS is what opens a queued number for bidding
  elsif p_action = 'timer' then
    update mazad_listings
       set status = 'open',
           end_at = now() + (coalesce(p_minutes, 1) || ' minutes')::interval
     where id = p_listing;

  elsif p_action = 'live' then
    update mazad_listings set is_live = false where is_live;
    update mazad_listings set is_live = true  where id = p_listing;

  elsif p_action = 'unlive' then
    update mazad_listings set is_live = false where id = p_listing;

  elsif p_action = 'next' then
    update mazad_listings set is_live = false where is_live;
    select id into v_next
      from mazad_listings
     where status in ('pending', 'open')
       and (end_at is null or end_at > now())
       and id <> coalesce(p_listing, id)
     order by created_at asc
     limit 1;
    if v_next is not null then
      update mazad_listings set is_live = true where id = v_next;
    end if;
    return json_build_object('ok', true, 'next', v_next);

  else
    return json_build_object('ok', false, 'error', 'bad_action');
  end if;

  return json_build_object('ok', true);
end;
$$;

revoke all on function mazad_admin(uuid, text, text, int, numeric) from public;
grant execute on function mazad_admin(uuid, text, text, int, numeric) to anon, authenticated;

-- ---------- operator fast listing ----------
-- For the guest who shows up mid-broadcast: the operator types the
-- number and it goes on air immediately. Allowed to be shorter than
-- the 5-minute floor the public insert policy enforces.

create or replace function mazad_create(
  p_secret  text,
  p_phone   text,
  p_carrier text,
  p_start   numeric,
  p_seller  text,
  p_contact text,
  p_note    text,
  p_minutes int  default 2,
  p_live    boolean default true
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_id     uuid;
begin
  select value into v_secret from mazad_config where key = 'admin_secret';
  if v_secret is null or p_secret is null or p_secret <> v_secret then
    return json_build_object('ok', false, 'error', 'forbidden');
  end if;

  if p_phone !~ '^05[0-9]{8}$' then
    return json_build_object('ok', false, 'error', 'bad_phone');
  end if;

  insert into mazad_listings (phone, carrier, start_price, seller_name, seller_contact, note, end_at, status)
  values (p_phone,
          nullif(p_carrier, ''),
          coalesce(p_start, 0),
          coalesce(nullif(btrim(p_seller), ''), 'البائع'),
          nullif(p_contact, ''),
          nullif(p_note, ''),
          now() + (greatest(coalesce(p_minutes, 2), 1) || ' minutes')::interval,
          'open')
  returning id into v_id;

  if p_live then
    update mazad_listings set is_live = false where is_live and id <> v_id;
    update mazad_listings set is_live = true  where id = v_id;
  end if;

  return json_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function mazad_create(text, text, text, numeric, text, text, text, int, boolean) from public;
grant execute on function mazad_create(text, text, text, numeric, text, text, text, int, boolean) to anon, authenticated;

-- ---------- server clock ----------
-- Countdowns must not be computed from the viewer's device clock: one that is
-- ten minutes slow shows a one-minute auction as eleven. The page calls this,
-- measures the difference, and corrects every time it displays.

create or replace function mazad_now()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$ select now() $$;

revoke all on function mazad_now() from public;
grant execute on function mazad_now() to anon, authenticated;

-- ---------- the sums still waiting on the operator ----------

create or replace function mazad_pending_bids(p_secret text)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_secret text;
begin
  select value into v_secret from mazad_config where key = 'admin_secret';
  if v_secret is null or p_secret is null or p_secret <> v_secret then
    return json_build_object('ok', false, 'error', 'forbidden');
  end if;

  return json_build_object('ok', true, 'bids', coalesce((
    select json_agg(row_to_json(x) order by x.created_at)
      from (
        select b.id, b.listing_id, b.bidder_name, b.amount, b.created_at, l.phone, l.is_live
          from mazad_bids b
          join mazad_listings l on l.id = b.listing_id
         where not b.approved and l.status = 'open'
      ) x
  ), '[]'::json));
end;
$$;

revoke all on function mazad_pending_bids(text) from public;
grant execute on function mazad_pending_bids(text) to anon, authenticated;

-- ---------- approve / reject one sum ----------

create or replace function mazad_bid_action(p_bid uuid, p_secret text, p_action text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret  text;
  v_bid     mazad_bids%rowtype;
  v_listing mazad_listings%rowtype;
  v_current numeric;
  v_new_end timestamptz;
begin
  select value into v_secret from mazad_config where key = 'admin_secret';
  if v_secret is null or p_secret is null or p_secret <> v_secret then
    return json_build_object('ok', false, 'error', 'forbidden');
  end if;

  select * into v_bid from mazad_bids where id = p_bid for update;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;

  if p_action = 'reject' then
    delete from mazad_bids where id = p_bid;
    return json_build_object('ok', true);
  end if;

  if p_action <> 'approve' then
    return json_build_object('ok', false, 'error', 'bad_action');
  end if;
  if v_bid.approved then return json_build_object('ok', true); end if;

  select * into v_listing from mazad_listings where id = v_bid.listing_id for update;

  select coalesce(max(amount), v_listing.start_price)
    into v_current
    from mazad_bids where listing_id = v_bid.listing_id and approved;

  -- approving a sum that no longer beats the price would move it backwards
  if v_bid.amount <= v_current then
    return json_build_object('ok', false, 'error', 'below_current', 'current', v_current);
  end if;

  update mazad_bids set approved = true, approved_at = now() where id = p_bid;

  -- the clock reacts to the approval, not to the shout
  v_new_end := v_listing.end_at;
  if v_listing.end_at is not null and v_listing.end_at - now() < interval '60 seconds' then
    v_new_end := now() + interval '2 minutes';
    update mazad_listings set end_at = v_new_end where id = v_listing.id;
  end if;

  return json_build_object('ok', true, 'amount', v_bid.amount, 'end_at', v_new_end);
end;
$$;

revoke all on function mazad_bid_action(uuid, text, text) from public;
grant execute on function mazad_bid_action(uuid, text, text) to anon, authenticated;
