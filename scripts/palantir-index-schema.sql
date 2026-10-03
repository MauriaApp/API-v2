-- Palantir: persisted index, written by the API on every /palantir/publish
-- and read back at boot. Personal-data-adjacent (rooms, groups, lessons),
-- so like colles_students: RLS enabled, zero policies — only the
-- service_role key (SUPABASE_SERVICE_KEY on mauria-api) can read or write.
--
-- Run once in the Supabase SQL editor.

create table if not exists public.palantir_index (
    id          bigint generated always as identity primary key,
    built_at    bigint not null,
    expires_at  bigint not null,
    window_start bigint not null,
    window_end  bigint not null,
    payload     jsonb not null,
    created_at  timestamptz not null default now()
);

alter table public.palantir_index enable row level security;
