-- RAFD — hiring-assessment submissions inbox.
--
-- Run this ONCE in the Supabase SQL editor:
--   Dashboard → SQL Editor → New query → paste this whole file → Run.
--
-- Until this table exists, the assessment still works: submissions fall back
-- to email + the RAFD1 submission code, and the review page says the inbox
-- is not set up yet.

create table if not exists public.assessment_submissions (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  candidate_name  text,
  candidate_email text,
  candidate_title text,
  candidate_years text,
  time_used_label text,
  submission      jsonb not null,
  report          jsonb,
  status          text not null default 'new',
  evaluated_at    timestamptz
);

-- Deny-all RLS on purpose: no policies means the anon key can neither read
-- nor write. Only the server (SUPABASE_SERVICE_KEY, which bypasses RLS)
-- touches this table, and the inbox endpoint requires ADMIN_PASSWORD.
alter table public.assessment_submissions enable row level security;
