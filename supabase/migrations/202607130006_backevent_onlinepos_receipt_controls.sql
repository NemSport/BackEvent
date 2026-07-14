create table if not exists public.backevent_onlinepos_receipt_controls (
  id uuid primary key default gen_random_uuid(),
  receipt_key text not null unique,
  onlinepos_transaction_id text null,
  receipt_number text null,
  classification text not null,
  control_types jsonb not null default '[]'::jsonb,
  control_keys jsonb not null default '[]'::jsonb,
  deposit_return_quantity numeric not null default 0,
  deposit_breakdown jsonb not null default '{}'::jsonb,
  purchase_value numeric not null default 0,
  deposit_return_value numeric not null default 0,
  final_total numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.backevent_onlinepos_receipt_control_notifications (
  id uuid primary key default gen_random_uuid(),
  receipt_control_id uuid not null references public.backevent_onlinepos_receipt_controls(id) on delete cascade,
  recipient_user_id uuid null references auth.users(id) on delete set null,
  dedupe_key text not null unique,
  push_message_id uuid null,
  status text not null default 'pending',
  error_message text null,
  created_at timestamptz not null default now(),
  constraint backevent_receipt_control_notification_status_check
    check (status in ('pending', 'sent', 'skipped', 'failed'))
);

create index if not exists backevent_onlinepos_receipt_controls_created_idx
  on public.backevent_onlinepos_receipt_controls(created_at desc);

create index if not exists backevent_receipt_control_notifications_control_idx
  on public.backevent_onlinepos_receipt_control_notifications(receipt_control_id);

create or replace function public.backevent_touch_onlinepos_receipt_control_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists backevent_touch_onlinepos_receipt_control_updated_at
  on public.backevent_onlinepos_receipt_controls;
create trigger backevent_touch_onlinepos_receipt_control_updated_at
  before update on public.backevent_onlinepos_receipt_controls
  for each row execute function public.backevent_touch_onlinepos_receipt_control_updated_at();

alter table public.backevent_onlinepos_receipt_controls enable row level security;
alter table public.backevent_onlinepos_receipt_control_notifications enable row level security;

drop policy if exists "backevent finance read onlinepos receipt controls"
  on public.backevent_onlinepos_receipt_controls;
create policy "backevent finance read onlinepos receipt controls"
  on public.backevent_onlinepos_receipt_controls for select to authenticated
  using (public.backevent_is_finance_responsible());

drop policy if exists "backevent owner write onlinepos receipt controls"
  on public.backevent_onlinepos_receipt_controls;
create policy "backevent owner write onlinepos receipt controls"
  on public.backevent_onlinepos_receipt_controls for all to authenticated
  using (public.backevent_is_owner())
  with check (public.backevent_is_owner());

drop policy if exists "backevent finance read onlinepos receipt control notifications"
  on public.backevent_onlinepos_receipt_control_notifications;
create policy "backevent finance read onlinepos receipt control notifications"
  on public.backevent_onlinepos_receipt_control_notifications for select to authenticated
  using (public.backevent_is_finance_responsible());

drop policy if exists "backevent owner write onlinepos receipt control notifications"
  on public.backevent_onlinepos_receipt_control_notifications;
create policy "backevent owner write onlinepos receipt control notifications"
  on public.backevent_onlinepos_receipt_control_notifications for all to authenticated
  using (public.backevent_is_owner())
  with check (public.backevent_is_owner());
