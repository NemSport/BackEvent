create table if not exists public.backevent_inventory_alert_runs (
  id uuid primary key default gen_random_uuid(),
  run_type text not null default 'manual',
  status text not null,
  checked_items integer not null default 0,
  sent_alerts integer not null default 0,
  suppressed_alerts integer not null default 0,
  failed_count integer not null default 0,
  error_message text null,
  created_at timestamptz not null default now(),
  constraint backevent_inventory_alert_runs_type_check check (run_type in ('manual', 'cron')),
  constraint backevent_inventory_alert_runs_status_check check (status in ('success', 'partial', 'failed', 'skipped'))
);

alter table public.backevent_inventory_alert_runs
  add column if not exists run_type text not null default 'manual';

alter table public.backevent_inventory_alert_runs
  add column if not exists status text;

alter table public.backevent_inventory_alert_runs
  add column if not exists checked_items integer not null default 0;

alter table public.backevent_inventory_alert_runs
  add column if not exists sent_alerts integer not null default 0;

alter table public.backevent_inventory_alert_runs
  add column if not exists suppressed_alerts integer not null default 0;

alter table public.backevent_inventory_alert_runs
  add column if not exists failed_count integer not null default 0;

alter table public.backevent_inventory_alert_runs
  add column if not exists error_message text null;

alter table public.backevent_inventory_alert_runs
  add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.backevent_inventory_alert_runs'::regclass
      and conname = 'backevent_inventory_alert_runs_type_check'
  ) then
    alter table public.backevent_inventory_alert_runs
      add constraint backevent_inventory_alert_runs_type_check check (run_type in ('manual', 'cron'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.backevent_inventory_alert_runs'::regclass
      and conname = 'backevent_inventory_alert_runs_status_check'
  ) then
    alter table public.backevent_inventory_alert_runs
      add constraint backevent_inventory_alert_runs_status_check check (status in ('success', 'partial', 'failed', 'skipped'));
  end if;
end;
$$;

create index if not exists idx_backevent_inventory_alert_runs_created_at
  on public.backevent_inventory_alert_runs(created_at desc);

create index if not exists idx_backevent_inventory_alert_runs_type_created_at
  on public.backevent_inventory_alert_runs(run_type, created_at desc);

alter table public.backevent_inventory_alert_runs enable row level security;

drop policy if exists "backevent owner read inventory alert runs" on public.backevent_inventory_alert_runs;
create policy "backevent owner read inventory alert runs"
  on public.backevent_inventory_alert_runs for select to authenticated
  using (public.backevent_is_owner());

drop policy if exists "backevent owner insert inventory alert runs" on public.backevent_inventory_alert_runs;
create policy "backevent owner insert inventory alert runs"
  on public.backevent_inventory_alert_runs for insert to authenticated
  with check (public.backevent_is_owner());
