create table if not exists public.leohub_state (
  id text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_leohub_state_updated_at
on public.leohub_state (updated_at desc);

alter table public.leohub_state enable row level security;

drop policy if exists "leohub_state_service_role_all" on public.leohub_state;
create policy "leohub_state_service_role_all"
on public.leohub_state
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
