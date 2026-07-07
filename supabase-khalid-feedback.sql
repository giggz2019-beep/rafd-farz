-- Run this once in the Supabase SQL editor (project: ycnnawohrbbluawxzttt) to
-- enable Khalid's end-of-conversation survey (referral source + rating) to be saved.
--
-- api/chat-khalid.js writes to this table using SUPABASE_SERVICE_KEY, which bypasses
-- RLS by default. RLS is enabled with no policies, so the anon/public key (never
-- present in any frontend file in this project) has no access to this table at all.

create table if not exists khalid_feedback (
  id uuid primary key default gen_random_uuid(),
  session_id text,
  customer_name text,
  referral_source text,
  rating text,
  created_at timestamptz not null default now()
);

alter table khalid_feedback enable row level security;
