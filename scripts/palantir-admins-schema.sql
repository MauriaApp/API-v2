-- Palantir: admin users, the only callers allowed to read people data
-- (teachers and student rosters) through /palantir/people. Like
-- palantir_index and colles_students: RLS enabled, zero policies — only
-- the service_role key (SUPABASE_SERVICE_KEY on mauria-api) can read or
-- write; the table is never exposed through a public endpoint.
--
-- Run once in the Supabase SQL editor, then insert the admins:
--   insert into public.palantir_admins (email) values ('…@student.junia.com');

create table if not exists public.palantir_admins (
    email      text primary key,
    created_at timestamptz not null default now()
);

alter table public.palantir_admins enable row level security;
