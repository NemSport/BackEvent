create table if not exists public.backevent_push_logs (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid null references auth.users(id) on delete set null,
  recipient_email text null,
  group_id uuid null references public.backevent_member_groups(id) on delete set null,
  title text not null,
  body text not null,
  status text not null,
  error_message text null,
  created_at timestamptz not null default now(),
  constraint backevent_push_logs_status_check check (status in ('sent', 'failed', 'skipped'))
);

alter table public.backevent_push_logs
  add column if not exists id uuid default gen_random_uuid();

alter table public.backevent_push_logs
  add column if not exists recipient_user_id uuid null references auth.users(id) on delete set null;

alter table public.backevent_push_logs
  add column if not exists recipient_email text null;

alter table public.backevent_push_logs
  add column if not exists group_id uuid null references public.backevent_member_groups(id) on delete set null;

alter table public.backevent_push_logs
  add column if not exists title text;

alter table public.backevent_push_logs
  add column if not exists body text;

alter table public.backevent_push_logs
  add column if not exists status text;

alter table public.backevent_push_logs
  add column if not exists error_message text null;

alter table public.backevent_push_logs
  add column if not exists created_at timestamptz default now();

alter table public.backevent_push_logs
  alter column title set not null,
  alter column body set not null,
  alter column status set not null,
  alter column created_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.backevent_push_logs'::regclass
      and conname = 'backevent_push_logs_status_check'
  ) then
    alter table public.backevent_push_logs
      add constraint backevent_push_logs_status_check check (status in ('sent', 'failed', 'skipped'));
  end if;
end;
$$;

create index if not exists idx_backevent_push_logs_created_at
  on public.backevent_push_logs(created_at desc);

create index if not exists idx_backevent_push_logs_group
  on public.backevent_push_logs(group_id);

create index if not exists idx_backevent_push_logs_recipient
  on public.backevent_push_logs(recipient_user_id);

alter table public.backevent_push_logs enable row level security;

drop policy if exists "backevent owner read push logs" on public.backevent_push_logs;
create policy "backevent owner read push logs"
  on public.backevent_push_logs for select to authenticated
  using (public.backevent_is_owner());

drop policy if exists "backevent owner insert push logs" on public.backevent_push_logs;
create policy "backevent owner insert push logs"
  on public.backevent_push_logs for insert to authenticated
  with check (public.backevent_is_owner());
