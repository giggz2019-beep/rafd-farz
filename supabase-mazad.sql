-- ============================================================
--  مزاد سوم  —  لوحات · جوالات · سيارات  (mazad.html)
--  Run this in the Supabase SQL editor. It is idempotent: running it
--  again on a database that already has it is a no-op.
--
--  Design notes
--  ------------
--  * The browser talks to Supabase directly with the ANON key
--    (no serverless function — api/ is already at Vercel's
--    12-function Hobby limit).
--  * Therefore NOTHING is trusted from the client:
--      - listings  : anon may INSERT (validated by CHECKs) and has NO
--                    select at all — the public reads the masked
--                    mazad_public view, which has no seller_contact.
--      - bids      : anon may SELECT named columns only (never
--                    bidder_phone). Sums are placed through place_bid(),
--                    and do not count until the operator approves them.
--      - no UPDATE / DELETE is granted to anon on anything.
--  * Closing / deleting a lot goes through mazad_admin(), which checks a
--    secret stored in mazad_config (unreadable by anon).
--
--  Two traps this file exists to keep shut — both are Supabase defaults
--  that hand anon more than you granted, and both were live once:
--    1. mazad_public is auto-updatable and runs as its owner, so an
--       UPDATE privilege on it is an UPDATE on mazad_listings with RLS
--       bypassed. Default privileges grant ALL on a new view, so the
--       revoke after each re-create is what closes it.
--    2. PostgreSQL grants EXECUTE on a new function to PUBLIC, and
--       Supabase grants it to anon and authenticated explicitly. An
--       internal SECURITY DEFINER helper is only internal once it is
--       revoked from all three by name.
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

-- the seller may name a price he is happy to sell at; a counted sum that
-- reaches it closes the lot without waiting for the clock
alter table mazad_listings add column if not exists auto_sell_price numeric(12,2);
alter table mazad_listings drop constraint if exists mazad_auto_sell_range;
alter table mazad_listings add  constraint mazad_auto_sell_range
  check (auto_sell_price is null
         or (auto_sell_price > start_price and auto_sell_price <= 100000000));

-- ---------- three sections on one engine: لوحات · جوالات · سيارات ----------
-- A lot is a phone number, a car plate, or a car. One table, one bidding
-- engine, one broadcast screen — item_type says which, and a single CHECK
-- says which columns each kind must and must not carry, so a half-filled row
-- cannot exist. Existing rows are phones, which is why the default is 'phone'.
alter table mazad_listings add column if not exists item_type     text not null default 'phone';
alter table mazad_listings add column if not exists plate_letters text;
alter table mazad_listings add column if not exists plate_digits  text;
alter table mazad_listings add column if not exists plate_emblem  text;
alter table mazad_listings add column if not exists car_make      text;
alter table mazad_listings add column if not exists car_model     text;
alter table mazad_listings add column if not exists car_year      int;
alter table mazad_listings add column if not exists car_photo     text;

-- phone is no longer required — it is null on a plate and on a car, so the
-- old column-level format CHECK has to go; mazad_item_shape carries it now.
alter table mazad_listings alter column phone drop not null;
alter table mazad_listings drop constraint if exists mazad_phone_format;

alter table mazad_listings drop constraint if exists mazad_item_type;
alter table mazad_listings add  constraint mazad_item_type
  check (item_type in ('phone','plate','car'));

-- Saudi plates carry up to three letters from a fixed 17-letter set (the ones
-- that have a Latin twin) and one to four digits. The letters are normalised
-- before they land (أ/إ/آ → ا, ى → ي, ة → ه) by the trigger below, so a seller
-- typing إ ب ح is not rejected for it.
-- ONE to three, not exactly three: a premium plate is usually a SHORT one —
-- «ا ب 1» is what gets auctioned, «ا ب ح 1234» is what comes on an ordinary
-- car — so demanding three refused exactly the plates worth listing.
alter table mazad_listings drop constraint if exists mazad_item_shape;
alter table mazad_listings add  constraint mazad_item_shape check (
     (item_type = 'phone'
       and phone ~ '^05[0-9]{8}$'
       and plate_letters is null and plate_digits is null
       and car_make is null and car_model is null and car_year is null)
  or (item_type = 'plate'
       and plate_letters ~ '^[ابحدرسصطعقكلمنهوي]{1,3}$'
       and plate_digits  ~ '^[0-9]{1,4}$'
       and phone is null
       and car_make is null and car_model is null and car_year is null)
  or (item_type = 'car'
       and char_length(btrim(car_make))  between 2 and 30
       and char_length(btrim(car_model)) between 1 and 30
       and car_year between 1970 and 2100
       and phone is null
       and plate_letters is null and plate_digits is null)
);

-- The emblem is the owner's own artwork, keyed by name. These five names are
-- his: سيفين ونخلة ملون / سيفين ونخلة أسود / شعار الرؤية 2030 / مداين صالح /
-- الدرعية. The page draws mazad-emb-<key>.png, so renaming a key here means
-- renaming the file too.
alter table mazad_listings drop constraint if exists mazad_emblem_on_plate_only;
alter table mazad_listings add  constraint mazad_emblem_on_plate_only
  check (plate_emblem is null or item_type = 'plate');
-- The plate's own TYPE. A Saudi plate comes in shapes, and the shape is part
-- of what is being sold: نقل is the blue one, صغيرة the short deep one off a
-- sports car. Measured off the owner's reference images — see mazad.html for
-- the cell divisions and ratios that go with each.
alter table mazad_listings add column if not exists plate_kind text;
alter table mazad_listings drop constraint if exists mazad_plate_kind_values;
alter table mazad_listings add  constraint mazad_plate_kind_values
  check (plate_kind is null or plate_kind in ('private','transport','small'));
alter table mazad_listings drop constraint if exists mazad_plate_kind_on_plate_only;
alter table mazad_listings add  constraint mazad_plate_kind_on_plate_only
  check (plate_kind is null or item_type = 'plate');
update mazad_listings set plate_kind = 'private'
 where item_type = 'plate' and plate_kind is null;

alter table mazad_listings drop constraint if exists mazad_plate_emblem_values;
alter table mazad_listings add  constraint mazad_plate_emblem_values
  check (plate_emblem is null
         or plate_emblem in ('none','swords','swords_black','vision','hegra','diriyah'));

-- a car photo is a path inside the mazad-cars bucket, never a URL: the page
-- builds the public URL from it, so a crafted row cannot point the <img> at
-- someone else's host.
alter table mazad_listings drop constraint if exists mazad_photo_on_car_only;
alter table mazad_listings add  constraint mazad_photo_on_car_only
  check (car_photo is null or item_type = 'car');
alter table mazad_listings drop constraint if exists mazad_photo_path;
alter table mazad_listings add  constraint mazad_photo_path
  check (car_photo is null or car_photo ~ '^[a-z0-9-]+/[a-zA-Z0-9._-]{1,80}$');

create index if not exists mazad_listings_kind_idx on mazad_listings (item_type, created_at desc);

-- ---------- plate letters are normalised at the source ----------
-- Not in the page: the page is one of several ways a row can arrive (the
-- operator's quick-add, a future import), and the CHECK above rejects أ/ى/ة
-- outright. Normalising in a BEFORE trigger means every path gets it.
create or replace function mazad_norm_plate(p text)
returns text language sql immutable as $$
  select translate(btrim(coalesce(p, '')), 'أإآىة', 'ااايه')
$$;

create or replace function mazad_norm_row()
returns trigger language plpgsql as $$
begin
  if new.plate_letters is not null then
    new.plate_letters := mazad_norm_plate(new.plate_letters);
  end if;
  return new;
end $$;

drop trigger if exists mazad_norm_before on mazad_listings;
create trigger mazad_norm_before
  before insert or update on mazad_listings
  for each row execute function mazad_norm_row();

create table if not exists mazad_bids (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references mazad_listings(id) on delete cascade,
  bidder_name text not null,
  amount      numeric(12,2) not null,
  created_at  timestamptz not null default now()
);

-- a winning bidder has to be reachable, so a sum carries his number. It is
-- OPERATOR-ONLY: anon is granted select on the other columns by name, never
-- this one, so the public feed cannot carry it even by asking for '*'.
alter table mazad_bids add column if not exists bidder_phone text;
alter table mazad_bids drop constraint if exists mazad_bidder_phone_format;
alter table mazad_bids add  constraint mazad_bidder_phone_format
  check (bidder_phone is null or bidder_phone ~ '^05[0-9]{8}$');

-- Where the bidder is. The handover is physical — the plate changes hands and
-- the ownership transfer happens at a particular counter — so the seller has
-- to know the city before he agrees. OPERATOR-ONLY for the same reason as the
-- number above: it is not in the anon column grant, so the public feed cannot
-- carry it even by asking for '*'.
alter table mazad_bids add column if not exists bidder_city text;
alter table mazad_bids drop constraint if exists mazad_bidder_city_len;
alter table mazad_bids add  constraint mazad_bidder_city_len
  check (bidder_city is null or char_length(bidder_city) between 2 and 40);

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
-- column by column, so bidder_phone is never readable from a browser
grant select (id, listing_id, bidder_name, amount, approved, created_at)
  on mazad_bids to anon, authenticated;

-- ---------- what the public may read ----------
-- A number waiting its turn must not be readable in full, or a viewer can take
-- it and negotiate with the seller outside the auction. Masking it in the page
-- is not enough — the full number would still travel to the browser. So the
-- public reads this view, and seller_contact is absent from it entirely.

-- CREATE OR REPLACE VIEW cannot insert a column in the middle of the list, so
-- adding one to this view means dropping it first and re-granting select.
drop view if exists mazad_public;
create view mazad_public as
select
  l.id,
  l.item_type,
  case
    when l.item_type <> 'phone' then null
    when l.status = 'pending' and not l.is_live
      then left(l.phone, 3) || '•••••' || right(l.phone, 2)
    else l.phone
  end                                      as phone,
  -- A queued plate shows its DIGITS and hides its LETTERS. It was the other
  -- way round, which gave away the half that identifies a plate: «ا ب ح» on
  -- its own is on half the cars in the street, but a viewer who reads the
  -- letters of a short plate has enough to go and find the seller. The digits
  -- are the part worth showing — they are what draws a bidder in — and the
  -- letters are what completes it, so they land when it goes on air.
  case
    when l.item_type <> 'plate' then l.plate_letters
    when l.status = 'pending' and not l.is_live
      then repeat('•', char_length(l.plate_letters))
    else l.plate_letters
  end                                      as plate_letters,
  case
    when l.item_type <> 'plate' then null
    else l.plate_digits
  end                                      as plate_digits,
  l.plate_emblem,
  l.plate_kind,
  l.car_make, l.car_model, l.car_year, l.car_photo,
  (l.item_type <> 'car' and l.status = 'pending' and not l.is_live) as phone_masked,
  l.carrier, l.start_price, l.seller_name, l.note,
  l.end_at, l.status, l.is_live, l.sold_price, l.auto_sell_price, l.created_at
from mazad_listings l;

alter view mazad_public set (security_invoker = off);

-- READ-ONLY, and the revoke is the important half. This view is
-- auto-updatable and runs as its owner, so a write privilege on it is a write
-- on mazad_listings with RLS bypassed. Supabase's default privileges grant ALL
-- on every new table and view in public to anon/authenticated, so each
-- re-create of this view silently handed the anon key UPDATE/DELETE/INSERT on
-- the listings — a price, a status or a whole lot could be changed with
-- nothing but the public key. Never drop the revoke.
revoke all on mazad_public from anon, authenticated, public;
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

-- Every earlier signature has to be DROPPED, not left beside the new one:
-- a defaulted extra argument creates an OVERLOAD, and a call naming only the
-- older arguments matches both and is refused as ambiguous. This has now
-- bitten place_bid twice — once for p_phone, once for p_city.
drop function if exists place_bid(uuid, text, numeric);
drop function if exists place_bid(uuid, text, numeric, text);

create or replace function place_bid(
  p_listing uuid,
  p_name    text,
  p_amount  numeric,
  p_phone   text default null,
  p_city    text default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing mazad_listings%rowtype;
  v_current numeric;
  v_step    numeric;
begin
  p_name  := btrim(coalesce(p_name, ''));
  p_phone := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
  p_city  := nullif(btrim(coalesce(p_city, '')), '');

  if char_length(p_name) < 2 or char_length(p_name) > 40 then
    return json_build_object('ok', false, 'error', 'bad_name');
  end if;

  -- a sum we cannot follow up on is no use to the seller
  if p_phone is null or p_phone !~ '^05[0-9]{8}$' then
    return json_build_object('ok', false, 'error', 'bad_phone');
  end if;

  -- and one we cannot arrange a handover for is no better
  if p_city is null or char_length(p_city) > 40 then
    return json_build_object('ok', false, 'error', 'bad_city');
  end if;

  select * into v_listing from mazad_listings where id = p_listing for update;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  if v_listing.status = 'pending' then return json_build_object('ok', false, 'error', 'not_started'); end if;
  if v_listing.status <> 'open' then return json_build_object('ok', false, 'error', 'closed'); end if;
  if v_listing.end_at is null or v_listing.end_at <= now() then
    return json_build_object('ok', false, 'error', 'expired');
  end if;

  -- the bar to clear is the highest APPROVED bid
  select coalesce(max(amount), v_listing.start_price)
    into v_current
    from mazad_bids where listing_id = p_listing and approved;

  v_step := greatest(50, ceil(v_current * 0.05));

  if p_amount is null or p_amount <= 0 or p_amount > 100000000 then
    return json_build_object('ok', false, 'error', 'bad_amount');
  end if;

  if p_amount < v_current + v_step then
    return json_build_object('ok', false, 'error', 'too_low',
                             'current', v_current, 'min', v_current + v_step);
  end if;

  if exists (select 1 from mazad_bids
              where listing_id = p_listing and bidder_name = p_name
                and created_at > now() - interval '3 seconds') then
    return json_build_object('ok', false, 'error', 'too_fast');
  end if;

  -- at most three of one person's bids may be waiting at a time
  if (select count(*) from mazad_bids
       where listing_id = p_listing and bidder_name = p_name and not approved) >= 3 then
    return json_build_object('ok', false, 'error', 'too_many_pending');
  end if;

  insert into mazad_bids (listing_id, bidder_name, bidder_phone, bidder_city, amount, approved)
  values (p_listing, p_name, p_phone, p_city, p_amount, false);

  -- no anti-sniping here: the clock moves when the operator approves
  return json_build_object('ok', true, 'pending', true, 'amount', p_amount);
end;
$$;

revoke all on function place_bid(uuid, text, numeric, text, text) from public;
grant execute on function place_bid(uuid, text, numeric, text, text) to anon, authenticated;

-- ---------- operator actions ----------
-- p_action: sold | unsold | cancelled | open | extend | timer | price | auto
--         | live | unlive | next | delete
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
  v_start  numeric;
  v_auto   boolean;
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
    -- only APPROVED sums are prices; a waiting one must not set the sale
    select coalesce(p_price,
                    (select max(amount) from mazad_bids
                      where listing_id = p_listing and approved),
                    l.start_price)
      into v_final
      from mazad_listings l where l.id = p_listing;
    update mazad_listings set status = 'sold', sold_price = v_final where id = p_listing;
    return json_build_object('ok', true, 'price', v_final);

  elsif p_action in ('unsold', 'cancelled') then
    update mazad_listings set status = p_action, sold_price = null where id = p_listing;

  elsif p_action = 'price' then
    update mazad_listings set sold_price = p_price where id = p_listing;

  -- the seller's auto-sell limit; a null price clears it
  elsif p_action = 'auto' then
    select start_price into v_start from mazad_listings where id = p_listing;
    if v_start is null then return json_build_object('ok', false, 'error', 'not_found'); end if;
    if p_price is not null and (p_price <= v_start or p_price > 100000000) then
      return json_build_object('ok', false, 'error', 'bad_amount', 'start', v_start);
    end if;
    update mazad_listings set auto_sell_price = p_price where id = p_listing;
    -- a limit set at or below what the lot already reached closes it now
    if p_price is not null then
      select coalesce(max(amount), v_start) into v_final
        from mazad_bids where listing_id = p_listing and approved;
      v_auto := mazad_try_auto_sell(p_listing, v_final);
      return json_build_object('ok', true, 'auto_sold', v_auto);
    end if;

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

-- ---------- the seller's auto-sell limit ----------
-- Called after a sum is COUNTED (approved, or entered by the operator), never
-- on submission: an unapproved sum must not be able to close a lot. Internal
-- only — no grant, so a browser cannot call it.

create or replace function mazad_try_auto_sell(p_listing uuid, p_amount numeric)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_row mazad_listings%rowtype;
begin
  select * into v_row from mazad_listings where id = p_listing;
  if not found then return false; end if;
  if v_row.auto_sell_price is null then return false; end if;
  if v_row.status not in ('open', 'pending') then return false; end if;
  if p_amount is null or p_amount < v_row.auto_sell_price then return false; end if;

  -- the lot stays on air wearing its sticker; only التالي clears is_live
  update mazad_listings
     set status = 'sold', sold_price = p_amount, end_at = now()
   where id = p_listing;
  return true;
end;
$$;

-- Internal only. Revoking FROM PUBLIC is not enough on Supabase: its default
-- privileges hand anon and authenticated an EXPLICIT execute grant on every new
-- function, which a revoke from public does not touch. Left as it was, the anon
-- key could POST /rest/v1/rpc/mazad_try_auto_sell and stamp any lot carrying an
-- auto-sell limit as sold, at any amount, with no secret and no approved sum.
-- The internal callers below are SECURITY DEFINER, so they still reach it.
revoke all on function mazad_try_auto_sell(uuid, numeric) from public, anon, authenticated;

-- ---------- operator fast listing ----------
-- For the guest who shows up mid-broadcast: the operator types the
-- number and it goes on air immediately. Allowed to be shorter than
-- the 5-minute floor the public insert policy enforces.
-- It carries no auto-sell limit; the page sets one with mazad_admin('auto').

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
as $$ select now() $$;

revoke all on function mazad_now() from public;
grant execute on function mazad_now() to anon, authenticated;

-- ---------- the sums still waiting on the operator ----------
-- RLS hides unapproved sums from the anon key, so the operator reads them
-- here. Each row carries the price it has to beat, the minimum that clears the
-- step, and whether it raises the price at all — without that the operator
-- cannot judge anything: 1,050 on a number at 7,000 looks the same as 1,050
-- on a number at 900.

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
    select json_agg(row_to_json(x) order by x.is_live desc, x.amount desc, x.created_at)
      from (
        select
          b.id, b.listing_id, b.bidder_name, b.bidder_phone, b.bidder_city,
          b.amount, b.created_at,
          l.phone, l.is_live,
          cur.price                                       as current,
          cur.price + greatest(50, ceil(cur.price * 0.05)) as min_next,
          (b.amount > cur.price)                          as beats_current
        from mazad_bids b
        join mazad_listings l on l.id = b.listing_id
        join lateral (
          select coalesce(max(a.amount), l.start_price) as price
            from mazad_bids a
           where a.listing_id = l.id and a.approved
        ) cur on true
       where not b.approved
         and l.status = 'open'
      ) x
  ), '[]'::json));
end;
$$;

revoke all on function mazad_pending_bids(text) from public;
grant execute on function mazad_pending_bids(text) to anon, authenticated;

-- ---------- approve / reject one sum ----------
-- Anti-sniping extends the clock on APPROVAL, not on submission, and a sum
-- that reaches the seller's limit closes the lot outright.

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
  v_auto    boolean := false;
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

  -- a finished lot takes no more sums, or «السومات المحتسبة» would contradict
  -- the sale price on the same card
  if v_listing.status not in ('open', 'pending') then
    return json_build_object('ok', false, 'error', 'finished', 'status', v_listing.status);
  end if;

  select coalesce(max(amount), v_listing.start_price)
    into v_current
    from mazad_bids where listing_id = v_bid.listing_id and approved;

  -- approving a sum that no longer beats the price would move it backwards
  if v_bid.amount <= v_current then
    return json_build_object('ok', false, 'error', 'below_current', 'current', v_current);
  end if;

  update mazad_bids set approved = true, approved_at = now() where id = p_bid;

  v_auto := mazad_try_auto_sell(v_listing.id, v_bid.amount);

  -- the clock reacts to the approval, not to the shout
  v_new_end := v_listing.end_at;
  if not v_auto
     and v_listing.end_at is not null
     and v_listing.end_at - now() < interval '60 seconds' then
    v_new_end := now() + interval '2 minutes';
    update mazad_listings set end_at = v_new_end where id = v_listing.id;
  end if;

  return json_build_object('ok', true, 'amount', v_bid.amount,
                           'end_at', v_new_end, 'auto_sold', v_auto);
end;
$$;

revoke all on function mazad_bid_action(uuid, text, text) from public;
grant execute on function mazad_bid_action(uuid, text, text) to anon, authenticated;

-- ---------- a sum the operator records himself ----------
-- For a guest on a TikTok call or a phone caller who never opens the site.
-- It is inserted already approved: the operator is the one entering it.

create or replace function mazad_manual_bid(p_listing uuid, p_secret text, p_name text, p_amount numeric)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret  text;
  v_listing mazad_listings%rowtype;
  v_current numeric;
  v_new_end timestamptz;
  v_auto    boolean := false;
begin
  select value into v_secret from mazad_config where key = 'admin_secret';
  if v_secret is null or p_secret is null or p_secret <> v_secret then
    return json_build_object('ok', false, 'error', 'forbidden');
  end if;

  p_name := btrim(coalesce(p_name, ''));
  if char_length(p_name) < 2 or char_length(p_name) > 40 then
    return json_build_object('ok', false, 'error', 'bad_name');
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000000 then
    return json_build_object('ok', false, 'error', 'bad_amount');
  end if;

  select * into v_listing from mazad_listings where id = p_listing for update;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;

  if v_listing.status not in ('open', 'pending') then
    return json_build_object('ok', false, 'error', 'finished', 'status', v_listing.status);
  end if;

  select coalesce(max(amount), v_listing.start_price)
    into v_current
    from mazad_bids where listing_id = p_listing and approved;

  -- the price is always the highest approved sum, so a lower one would do
  -- nothing; say so instead of silently swallowing it
  if p_amount <= v_current then
    return json_build_object('ok', false, 'error', 'below_current', 'current', v_current);
  end if;

  insert into mazad_bids (listing_id, bidder_name, amount, approved, approved_at)
  values (p_listing, p_name, p_amount, true, now());

  v_auto := mazad_try_auto_sell(p_listing, p_amount);

  v_new_end := v_listing.end_at;
  if not v_auto
     and v_listing.end_at is not null
     and v_listing.end_at - now() < interval '60 seconds' then
    v_new_end := now() + interval '2 minutes';
    update mazad_listings set end_at = v_new_end where id = p_listing;
  end if;

  return json_build_object('ok', true, 'amount', p_amount,
                           'end_at', v_new_end, 'auto_sold', v_auto);
end;
$$;

revoke all on function mazad_manual_bid(uuid, text, text, numeric) from public;
grant execute on function mazad_manual_bid(uuid, text, text, numeric) to anon, authenticated;

-- ---------- every sum on one number, approved or not ----------
-- The operator's undo list: removing an approval given by mistake is the only
-- way to bring the price back down.

create or replace function mazad_bids_of(p_listing uuid, p_secret text)
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
    select json_agg(row_to_json(x) order by x.amount desc)
      from (select id, bidder_name, bidder_phone, bidder_city, amount, approved, created_at
              from mazad_bids where listing_id = p_listing) x
  ), '[]'::json));
end;
$$;

revoke all on function mazad_bids_of(uuid, text) from public;
grant execute on function mazad_bids_of(uuid, text) to anon, authenticated;

-- ---------- operator fast listing: a plate ----------
-- Same job as mazad_create, for a لوحة. Separate functions rather than one
-- with a kind argument: each kind validates different fields, and a defaulted
-- argument added later would create an overload, not a replacement.
create or replace function mazad_create_plate(
  p_secret  text,
  p_letters text,
  p_digits  text,
  p_start   numeric,
  p_seller  text,
  p_contact text,
  p_minutes int     default 2,
  p_live    boolean default true,
  p_auto    numeric default null,
  p_emblem  text    default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_id     uuid;
  v_start  numeric;
begin
  select value into v_secret from mazad_config where key = 'admin_secret';
  if v_secret is null or p_secret is null or p_secret <> v_secret then
    return json_build_object('ok', false, 'error', 'forbidden');
  end if;

  p_letters := mazad_norm_plate(p_letters);
  p_digits  := btrim(coalesce(p_digits, ''));
  p_emblem  := nullif(btrim(coalesce(p_emblem, '')), '');

  if p_letters !~ '^[ابحدرسصطعقكلمنهوي]{1,3}$' then
    return json_build_object('ok', false, 'error', 'bad_letters');
  end if;
  if p_digits !~ '^[0-9]{1,4}$' then
    return json_build_object('ok', false, 'error', 'bad_digits');
  end if;
  if p_emblem is not null
     and p_emblem not in ('none','swords','swords_black','vision','hegra','diriyah') then
    return json_build_object('ok', false, 'error', 'bad_emblem');
  end if;

  v_start := coalesce(p_start, 0);
  if p_auto is not null and (p_auto <= v_start or p_auto > 100000000) then
    return json_build_object('ok', false, 'error', 'bad_auto');
  end if;

  insert into mazad_listings (item_type, plate_letters, plate_digits, plate_emblem, phone,
                              start_price, seller_name, seller_contact,
                              end_at, status, auto_sell_price)
  values ('plate', p_letters, p_digits, coalesce(p_emblem, 'swords'), null,
          v_start,
          coalesce(nullif(btrim(p_seller), ''), 'البائع'),
          nullif(p_contact, ''),
          now() + (greatest(coalesce(p_minutes, 2), 1) || ' minutes')::interval,
          'open', p_auto)
  returning id into v_id;

  if p_live then
    update mazad_listings set is_live = false where is_live and id <> v_id;
    update mazad_listings set is_live = true  where id = v_id;
  end if;

  return json_build_object('ok', true, 'id', v_id);
end;
$$;

grant execute on function
  mazad_create_plate(text, text, text, numeric, text, text, int, boolean, numeric, text)
  to anon, authenticated;

-- ---------- operator fast listing: a car ----------
create or replace function mazad_create_car(
  p_secret  text,
  p_make    text,
  p_model   text,
  p_year    int,
  p_start   numeric,
  p_seller  text,
  p_contact text,
  p_minutes int     default 2,
  p_live    boolean default true,
  p_auto    numeric default null,
  p_photo   text    default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_id     uuid;
  v_start  numeric;
begin
  select value into v_secret from mazad_config where key = 'admin_secret';
  if v_secret is null or p_secret is null or p_secret <> v_secret then
    return json_build_object('ok', false, 'error', 'forbidden');
  end if;

  p_make  := btrim(coalesce(p_make, ''));
  p_model := btrim(coalesce(p_model, ''));
  p_photo := nullif(btrim(coalesce(p_photo, '')), '');

  if char_length(p_make) < 2 or char_length(p_make) > 30 then
    return json_build_object('ok', false, 'error', 'bad_make');
  end if;
  if char_length(p_model) < 1 or char_length(p_model) > 30 then
    return json_build_object('ok', false, 'error', 'bad_model');
  end if;
  if p_year is null or p_year < 1970 or p_year > 2100 then
    return json_build_object('ok', false, 'error', 'bad_year');
  end if;
  -- a path in the bucket, never a URL
  if p_photo is not null and p_photo !~ '^[a-z0-9-]+/[a-zA-Z0-9._-]{1,80}$' then
    return json_build_object('ok', false, 'error', 'bad_photo');
  end if;

  v_start := coalesce(p_start, 0);
  if p_auto is not null and (p_auto <= v_start or p_auto > 100000000) then
    return json_build_object('ok', false, 'error', 'bad_auto');
  end if;

  insert into mazad_listings (item_type, car_make, car_model, car_year, car_photo, phone,
                              start_price, seller_name, seller_contact,
                              end_at, status, auto_sell_price)
  values ('car', p_make, p_model, p_year, p_photo, null,
          v_start,
          coalesce(nullif(btrim(p_seller), ''), 'البائع'),
          nullif(p_contact, ''),
          now() + (greatest(coalesce(p_minutes, 2), 1) || ' minutes')::interval,
          'open', p_auto)
  returning id into v_id;

  if p_live then
    update mazad_listings set is_live = false where is_live and id <> v_id;
    update mazad_listings set is_live = true  where id = v_id;
  end if;

  return json_build_object('ok', true, 'id', v_id);
end;
$$;

grant execute on function
  mazad_create_car(text, text, text, int, numeric, text, text, int, boolean, numeric, text)
  to anon, authenticated;

-- ---------- the emblem on a plate already listed ----------
-- The seller is asked which emblem his plate carries; if he answers late, or
-- answers wrong, the operator fixes it from the control panel.
create or replace function mazad_set_emblem(p_listing uuid, p_secret text, p_emblem text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v_secret text; v_type text;
begin
  select value into v_secret from mazad_config where key = 'admin_secret';
  if v_secret is null or p_secret is null or p_secret <> v_secret then
    return json_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_emblem not in ('none','swords','swords_black','vision','hegra','diriyah') then
    return json_build_object('ok', false, 'error', 'bad_emblem');
  end if;
  select item_type into v_type from mazad_listings where id = p_listing;
  if v_type is null then return json_build_object('ok', false, 'error', 'not_found'); end if;
  if v_type <> 'plate' then return json_build_object('ok', false, 'error', 'not_a_plate'); end if;

  update mazad_listings set plate_emblem = p_emblem where id = p_listing;
  return json_build_object('ok', true, 'emblem', p_emblem);
end;
$$;

grant execute on function mazad_set_emblem(uuid, text, text) to anon, authenticated;

-- ---------- the plate's type, switched on air ----------
-- Its own function rather than a defaulted argument on mazad_set_item: a
-- defaulted argument creates an overload, and a call naming only the original
-- arguments then matches both and is refused as ambiguous.
create or replace function mazad_set_plate_kind(p_listing uuid, p_secret text, p_kind text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v_secret text; v_type text;
begin
  select value into v_secret from mazad_config where key = 'admin_secret';
  if v_secret is null or p_secret is null or p_secret <> v_secret then
    return json_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_kind not in ('private','transport','small') then
    return json_build_object('ok', false, 'error', 'bad_kind');
  end if;
  select item_type into v_type from mazad_listings where id = p_listing;
  if v_type is null then return json_build_object('ok', false, 'error', 'not_found'); end if;
  if v_type <> 'plate' then return json_build_object('ok', false, 'error', 'not_a_plate'); end if;

  update mazad_listings set plate_kind = p_kind where id = p_listing;
  return json_build_object('ok', true, 'plate_kind', p_kind);
end;
$$;

grant execute on function mazad_set_plate_kind(uuid, text, text) to anon, authenticated;

-- ---------- correcting what is on air, while it is on air ----------
-- The operator reads the plate off the seller's paper on camera and gets a
-- letter wrong, or the seller corrects him mid-call. Re-listing would throw
-- away the sums and the clock, so the identity itself is editable in place.
-- Null means "leave this field alone", so the page can send one box at a time
-- as it is typed. A finished lot is refused: what it sold as must not change
-- under it.
create or replace function mazad_set_item(
  p_listing uuid,
  p_secret  text,
  p_letters text default null,
  p_digits  text default null,
  p_phone   text default null,
  p_make    text default null,
  p_model   text default null,
  p_year    int  default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_row    mazad_listings%rowtype;
  v_bids   int;
begin
  select value into v_secret from mazad_config where key = 'admin_secret';
  if v_secret is null or p_secret is null or p_secret <> v_secret then
    return json_build_object('ok', false, 'error', 'forbidden');
  end if;

  select * into v_row from mazad_listings where id = p_listing;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  if v_row.status in ('sold','unsold','cancelled') then
    return json_build_object('ok', false, 'error', 'finished');
  end if;

  if v_row.item_type = 'plate' then
    if p_letters is not null then
      p_letters := mazad_norm_plate(p_letters);
      if p_letters !~ '^[ابحدرسصطعقكلمنهوي]{1,3}$' then
        return json_build_object('ok', false, 'error', 'bad_letters');
      end if;
      update mazad_listings set plate_letters = p_letters where id = p_listing;
    end if;
    if p_digits is not null then
      p_digits := btrim(p_digits);
      if p_digits !~ '^[0-9]{1,4}$' then
        return json_build_object('ok', false, 'error', 'bad_digits');
      end if;
      update mazad_listings set plate_digits = p_digits where id = p_listing;
    end if;

  elsif v_row.item_type = 'phone' then
    if p_phone is not null then
      p_phone := btrim(p_phone);
      if p_phone !~ '^05[0-9]{8}$' then
        return json_build_object('ok', false, 'error', 'bad_phone');
      end if;
      update mazad_listings set phone = p_phone where id = p_listing;
    end if;

  else  -- car
    if p_make is not null then
      p_make := btrim(p_make);
      if char_length(p_make) < 2 or char_length(p_make) > 30 then
        return json_build_object('ok', false, 'error', 'bad_make');
      end if;
      update mazad_listings set car_make = p_make where id = p_listing;
    end if;
    if p_model is not null then
      p_model := btrim(p_model);
      if char_length(p_model) < 1 or char_length(p_model) > 30 then
        return json_build_object('ok', false, 'error', 'bad_model');
      end if;
      update mazad_listings set car_model = p_model where id = p_listing;
    end if;
    if p_year is not null then
      if p_year < 1970 or p_year > 2100 then
        return json_build_object('ok', false, 'error', 'bad_year');
      end if;
      update mazad_listings set car_year = p_year where id = p_listing;
    end if;
  end if;

  select * into v_row from mazad_listings where id = p_listing;
  select count(*) into v_bids from mazad_bids where listing_id = p_listing and approved;

  -- the page warns him when he has just renamed something people already
  -- bid on, so the count comes back with the new identity
  return json_build_object(
    'ok', true,
    'item_type',     v_row.item_type,
    'plate_letters', v_row.plate_letters,
    'plate_digits',  v_row.plate_digits,
    'phone',         v_row.phone,
    'car_make',      v_row.car_make,
    'car_model',     v_row.car_model,
    'car_year',      v_row.car_year,
    'approved_bids', v_bids
  );
end;
$$;

grant execute on function mazad_set_item(uuid, text, text, text, text, text, text, int)
  to anon, authenticated;

-- ---------- the car photo bucket ----------
-- A car is judged on its photo, so the seller uploads one before the lot is
-- created and the row stores the PATH. The bucket is insert-only on purpose:
-- anon may add a file and everyone may read it, but nothing anon can send
-- replaces or deletes one. The size and mime limits are enforced by the
-- bucket, not by the page, so a crafted upload cannot get past them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mazad-cars', 'mazad-cars', true, 3145728,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists mazad_cars_read   on storage.objects;
drop policy if exists mazad_cars_insert on storage.objects;

create policy mazad_cars_read on storage.objects
  for select to anon, authenticated using (bucket_id = 'mazad-cars');

create policy mazad_cars_insert on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'mazad-cars');
-- no update/delete policy => an uploaded photo cannot be swapped or removed
