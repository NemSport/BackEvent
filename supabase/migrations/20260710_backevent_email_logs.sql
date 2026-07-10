create table if not exists public.backevent_email_logs (
  id uuid primary key default gen_random_uuid(),
  recipient_email text not null,
  recipient_name text null,
  subject text not null,
  category text not null,
  status text not null default 'pending',
  error_message text null,
  sent_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint backevent_email_logs_category_check check (
    category in ('inventory_low_stock', 'inventory_critical_stock', 'inventory_report', 'general_message')
  ),
  constraint backevent_email_logs_status_check check (status in ('pending', 'sent', 'failed'))
);

create index if not exists idx_backevent_email_logs_created_at
  on public.backevent_email_logs(created_at desc);

create index if not exists idx_backevent_email_logs_category
  on public.backevent_email_logs(category);

create index if not exists idx_backevent_email_logs_status
  on public.backevent_email_logs(status);

alter table public.backevent_email_logs enable row level security;

drop policy if exists "backevent owner read email logs" on public.backevent_email_logs;
create policy "backevent owner read email logs"
  on public.backevent_email_logs for select to authenticated
  using (public.backevent_is_owner());

drop policy if exists "backevent owner insert email logs" on public.backevent_email_logs;
create policy "backevent owner insert email logs"
  on public.backevent_email_logs for insert to authenticated
  with check (public.backevent_is_owner());

drop policy if exists "backevent owner update email logs" on public.backevent_email_logs;
create policy "backevent owner update email logs"
  on public.backevent_email_logs for update to authenticated
  using (public.backevent_is_owner())
  with check (public.backevent_is_owner());
