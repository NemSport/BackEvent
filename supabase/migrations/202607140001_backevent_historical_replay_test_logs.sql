create table if not exists public.backevent_historical_replay_test_logs (
  id uuid primary key default gen_random_uuid(),
  replay_run_id text not null unique,
  run_by uuid null references auth.users(id) on delete set null,
  interval_from timestamptz not null,
  interval_to timestamptz not null,
  preview jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.backevent_historical_replay_test_logs enable row level security;

create policy "backevent owner read historical replay test logs"
  on public.backevent_historical_replay_test_logs for select to authenticated
  using (public.backevent_is_owner());

create policy "backevent owner write historical replay test logs"
  on public.backevent_historical_replay_test_logs for all to authenticated
  using (public.backevent_is_owner())
with check (public.backevent_is_owner());

alter table public.backevent_onlinepos_receipt_controls
  add column if not exists status text not null default 'open',
  add column if not exists source text not null default 'live',
  add column if not exists replay_run_id text null;

alter table public.backevent_onlinepos_receipt_controls
  drop constraint if exists backevent_onlinepos_receipt_controls_status_check;
alter table public.backevent_onlinepos_receipt_controls
  add constraint backevent_onlinepos_receipt_controls_status_check
  check (status in ('open', 'resolved', 'dismissed', 'test'));
