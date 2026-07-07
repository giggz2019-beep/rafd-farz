-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Adds a column to store each applicant's per-criterion score breakdown,
-- so the partner dashboard can show it (feature added 2026-07-07).

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS criteria_breakdown jsonb;
