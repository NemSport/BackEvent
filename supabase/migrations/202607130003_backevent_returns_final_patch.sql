-- Final idempotent patch for BackEvent return control and OnlinePOS mapping.
-- Earlier migration versions may already be marked as applied remotely, so this
-- patch re-applies the final definitions without deleting production data.

alter table public.backevent_products
  add column if not exists return_handling text;

alter table public.backevent_products
  alter column return_handling drop not null,
  alter column return_handling drop default;

alter table public.backevent_products
  drop constraint if exists backevent_products_return_handling_check;

alter table public.backevent_products
  add constraint backevent_products_return_handling_check
  check (return_handling is null or return_handling in ('waste', 'return_to_stock', 'manual_review', 'no_stock_effect'));

insert into public.backevent_member_groups (name, description, active)
select 'Økonomiansvarlige', 'Modtager besked og læseadgang til OnlinePOS-returer.', true
where not exists (
  select 1
  from public.backevent_member_groups
  where lower(name) = lower('Økonomiansvarlige')
);

create table if not exists public.backevent_returns (
  id uuid primary key default gen_random_uuid(),
  location_id uuid null references public.backevent_locations(id) on delete set null,
  source_location_id uuid null references public.backevent_locations(id) on delete set null,
  onlinepos_venue_id text null,
  onlinepos_location_ref text null,
  onlinepos_returned_at timestamptz null,
  received_at timestamptz not null default now(),
  receipt_number text null,
  onlinepos_transaction_id text null,
  onlinepos_return_id text null,
  original_transaction_id text null,
  external_idempotency_key text not null,
  content_hash text null,
  total_amount numeric not null default 0,
  product_amount numeric not null default 0,
  deposit_amount numeric not null default 0,
  cup_amount numeric not null default 0,
  currency text not null default 'DKK',
  processing_status text not null default 'registered',
  control_status text not null default 'not_required',
  control_reasons jsonb not null default '[]'::jsonb,
  suspicion_flags jsonb not null default '[]'::jsonb,
  stock_status text not null default 'not_started',
  source text not null default 'onlinepos',
  test_scenario text null,
  created_by uuid null references auth.users(id) on delete set null,
  created_by_name text null,
  raw_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.backevent_returns
  add column if not exists location_id uuid null references public.backevent_locations(id) on delete set null,
  add column if not exists source_location_id uuid null references public.backevent_locations(id) on delete set null,
  add column if not exists onlinepos_venue_id text null,
  add column if not exists onlinepos_location_ref text null,
  add column if not exists onlinepos_returned_at timestamptz null,
  add column if not exists received_at timestamptz not null default now(),
  add column if not exists receipt_number text null,
  add column if not exists onlinepos_transaction_id text null,
  add column if not exists onlinepos_return_id text null,
  add column if not exists original_transaction_id text null,
  add column if not exists external_idempotency_key text,
  add column if not exists content_hash text null,
  add column if not exists total_amount numeric not null default 0,
  add column if not exists product_amount numeric not null default 0,
  add column if not exists deposit_amount numeric not null default 0,
  add column if not exists cup_amount numeric not null default 0,
  add column if not exists currency text not null default 'DKK',
  add column if not exists processing_status text not null default 'registered',
  add column if not exists control_status text not null default 'not_required',
  add column if not exists control_reasons jsonb not null default '[]'::jsonb,
  add column if not exists suspicion_flags jsonb not null default '[]'::jsonb,
  add column if not exists stock_status text not null default 'not_started',
  add column if not exists source text not null default 'onlinepos',
  add column if not exists test_scenario text null,
  add column if not exists created_by uuid null references auth.users(id) on delete set null,
  add column if not exists created_by_name text null,
  add column if not exists raw_metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.backevent_return_lines (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.backevent_returns(id) on delete cascade,
  onlinepos_line_id text null,
  external_return_line_id text not null,
  original_onlinepos_line_id text null,
  original_transaction_line_id text null,
  onlinepos_product_id text null,
  backevent_product_id uuid null references public.backevent_products(id) on delete set null,
  product_description text not null,
  returned_quantity numeric not null default 0,
  input_unit text null,
  unit text null,
  unit_price numeric null,
  line_amount numeric not null default 0,
  line_type text not null default 'unknown',
  parent_external_line_id text null,
  return_handling text not null default 'manual_review',
  is_deposit boolean not null default false,
  is_cup boolean not null default false,
  is_fee boolean not null default false,
  affects_stock boolean not null default false,
  calculated_stock_quantity numeric not null default 0,
  stock_processed_quantity numeric not null default 0,
  waste_registered_quantity numeric not null default 0,
  waste_adjustment_id uuid null references public.backevent_stock_adjustments(id) on delete set null,
  processing_status text not null default 'registered',
  error_message text null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.backevent_return_lines
  add column if not exists input_unit text null,
  add column if not exists parent_external_line_id text null,
  add column if not exists waste_registered_quantity numeric not null default 0,
  add column if not exists waste_adjustment_id uuid null references public.backevent_stock_adjustments(id) on delete set null;

alter table public.backevent_return_lines
  drop constraint if exists backevent_return_lines_handling_check,
  drop constraint if exists backevent_return_lines_status_check;

alter table public.backevent_return_lines
  add constraint backevent_return_lines_handling_check
  check (return_handling in ('waste', 'return_to_stock', 'manual_review', 'no_stock_effect')),
  add constraint backevent_return_lines_status_check
  check (processing_status in ('registered', 'processed', 'requires_review', 'failed', 'duplicate', 'ignored', 'returned_to_stock', 'waste_registered', 'no_stock_effect'));

alter table public.backevent_stock_adjustments
  add column if not exists return_id uuid null references public.backevent_returns(id) on delete set null,
  add column if not exists return_line_id uuid null references public.backevent_return_lines(id) on delete set null,
  add column if not exists external_reference text null;

create table if not exists public.backevent_return_history (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.backevent_returns(id) on delete cascade,
  return_line_id uuid null references public.backevent_return_lines(id) on delete set null,
  action text not null,
  actor_user_id uuid null references auth.users(id) on delete set null,
  actor_name text null,
  before_data jsonb null,
  after_data jsonb null,
  metadata jsonb not null default '{}'::jsonb,
  error_message text null,
  created_at timestamptz not null default now()
);

create table if not exists public.backevent_return_notifications (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.backevent_returns(id) on delete cascade,
  recipient_user_id uuid null references auth.users(id) on delete set null,
  dedupe_key text not null,
  notification_type text not null,
  push_message_id uuid null,
  status text not null default 'pending',
  error_message text null,
  created_at timestamptz not null default now()
);

create table if not exists public.backevent_return_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'manual',
  datetime_from timestamptz not null,
  datetime_to timestamptz not null,
  status text not null default 'running',
  page_count int not null default 0,
  transaction_count int not null default 0,
  return_count int not null default 0,
  processed_line_count int not null default 0,
  review_count int not null default 0,
  duplicate_count int not null default 0,
  error_message text null,
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  created_at timestamptz not null default now()
);

alter table public.backevent_return_notifications
  drop constraint if exists backevent_return_notifications_status_check;

alter table public.backevent_return_notifications
  add constraint backevent_return_notifications_status_check
  check (status in ('pending', 'sent', 'skipped', 'failed'));

alter table public.backevent_return_sync_runs
  drop constraint if exists backevent_return_sync_runs_status_check;

alter table public.backevent_return_sync_runs
  add constraint backevent_return_sync_runs_status_check
  check (status in ('running', 'completed', 'partial', 'failed'));

create unique index if not exists backevent_returns_external_key_unique_idx
  on public.backevent_returns(external_idempotency_key);

create unique index if not exists backevent_return_lines_external_unique_idx
  on public.backevent_return_lines(external_return_line_id);

create unique index if not exists backevent_return_lines_idempotency_unique_idx
  on public.backevent_return_lines(idempotency_key);

create unique index if not exists backevent_return_notifications_dedupe_unique_idx
  on public.backevent_return_notifications(dedupe_key);

create index if not exists idx_backevent_returns_created on public.backevent_returns(created_at desc);
create index if not exists idx_backevent_returns_status on public.backevent_returns(processing_status, control_status);
create index if not exists idx_backevent_returns_location on public.backevent_returns(location_id);
create index if not exists idx_backevent_return_lines_return on public.backevent_return_lines(return_id);
create index if not exists idx_backevent_return_lines_product on public.backevent_return_lines(backevent_product_id);
create index if not exists idx_backevent_return_lines_parent_external
  on public.backevent_return_lines(return_id, parent_external_line_id)
  where parent_external_line_id is not null;
create index if not exists idx_backevent_return_history_return on public.backevent_return_history(return_id, created_at desc);
create index if not exists idx_backevent_return_notifications_return on public.backevent_return_notifications(return_id);
create index if not exists idx_backevent_return_sync_runs_started on public.backevent_return_sync_runs(started_at desc);
create index if not exists idx_backevent_stock_adjustments_return on public.backevent_stock_adjustments(return_id, return_line_id);
create index if not exists backevent_returns_test_harness_idx
  on public.backevent_returns(source, test_scenario, created_at desc)
  where source = 'test_harness';

create table if not exists public.backevent_onlinepos_location_mappings (
  id uuid primary key default gen_random_uuid(),
  onlinepos_venue_id text null,
  onlinepos_cash_register_id text null,
  onlinepos_cash_register_name text not null,
  normalized_cash_register_name text not null,
  backevent_location_id uuid null references public.backevent_locations(id) on delete restrict,
  active boolean not null default true,
  first_seen_at timestamptz null,
  last_seen_at timestamptz null,
  created_by uuid null references auth.users(id) on delete set null,
  updated_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists backevent_onlinepos_location_mappings_id_unique
  on public.backevent_onlinepos_location_mappings (
    coalesce(onlinepos_venue_id, ''),
    onlinepos_cash_register_id
  )
  where onlinepos_cash_register_id is not null;

create unique index if not exists backevent_onlinepos_location_mappings_name_unique
  on public.backevent_onlinepos_location_mappings (
    coalesce(onlinepos_venue_id, ''),
    normalized_cash_register_name
  )
  where onlinepos_cash_register_id is null;

create index if not exists backevent_onlinepos_location_mappings_location_idx
  on public.backevent_onlinepos_location_mappings(backevent_location_id);

create index if not exists backevent_onlinepos_location_mappings_active_idx
  on public.backevent_onlinepos_location_mappings(active);

alter table public.backevent_onlinepos_location_mappings
  alter column backevent_location_id drop not null;

create or replace function public.backevent_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists backevent_returns_touch_updated_at on public.backevent_returns;
create trigger backevent_returns_touch_updated_at
  before update on public.backevent_returns
  for each row execute function public.backevent_touch_updated_at();

drop trigger if exists backevent_return_lines_touch_updated_at on public.backevent_return_lines;
create trigger backevent_return_lines_touch_updated_at
  before update on public.backevent_return_lines
  for each row execute function public.backevent_touch_updated_at();

create or replace function public.backevent_touch_onlinepos_location_mapping_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists backevent_touch_onlinepos_location_mapping_updated_at
  on public.backevent_onlinepos_location_mappings;

create trigger backevent_touch_onlinepos_location_mapping_updated_at
  before update on public.backevent_onlinepos_location_mappings
  for each row
  execute function public.backevent_touch_onlinepos_location_mapping_updated_at();

create or replace function public.backevent_is_finance_responsible()
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.backevent_is_responsible()
    or exists (
      select 1
      from public.backevent_member_group_members memberships
      join public.backevent_member_groups groups on groups.id = memberships.group_id
      join public.backevent_profiles profiles on profiles.id = memberships.profile_id
      where memberships.profile_id = auth.uid()
        and profiles.active = true
        and groups.active = true
        and lower(groups.name) = lower('Økonomiansvarlige')
    );
$$;

create or replace function public.backevent_refresh_return_status(p_return_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  total_lines int;
  failed_lines int;
  review_lines int;
  processed_lines int;
  stock_lines int;
begin
  select
    count(*),
    count(*) filter (where processing_status = 'failed'),
    count(*) filter (where processing_status = 'requires_review'),
    count(*) filter (where processing_status in ('processed', 'returned_to_stock', 'waste_registered', 'no_stock_effect', 'ignored')),
    count(*) filter (where affects_stock = true)
  into total_lines, failed_lines, review_lines, processed_lines, stock_lines
  from public.backevent_return_lines
  where return_id = p_return_id;

  update public.backevent_returns
  set
    processing_status = case
      when failed_lines > 0 then 'processing_failed'
      when review_lines > 0 then 'requires_review'
      when total_lines > 0 and processed_lines = total_lines then 'processed'
      else processing_status
    end,
    control_status = case
      when review_lines > 0 or failed_lines > 0 then 'open'
      else control_status
    end,
    stock_status = case
      when stock_lines = 0 then 'not_applicable'
      when failed_lines > 0 then 'failed'
      when total_lines > 0 and processed_lines = total_lines then 'processed'
      else 'partial'
    end
  where id = p_return_id;
end;
$$;

create or replace function public.backevent_process_return_line(p_return_line_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  line_record public.backevent_return_lines%rowtype;
  return_record public.backevent_returns%rowtype;
  balance_record public.backevent_stock_balances%rowtype;
  adjustment_id uuid;
  quantity_after numeric;
begin
  if auth.role() <> 'service_role' and not public.backevent_is_owner() then
    raise exception 'Kun ejer kan behandle retur';
  end if;

  select * into line_record
  from public.backevent_return_lines
  where id = p_return_line_id
  for update;

  if not found then
    raise exception 'Returlinje findes ikke';
  end if;

  if line_record.processing_status in ('returned_to_stock', 'waste_registered', 'no_stock_effect', 'ignored', 'processed') then
    return jsonb_build_object('ok', true, 'status', line_record.processing_status, 'alreadyProcessed', true);
  end if;

  select * into return_record
  from public.backevent_returns
  where id = line_record.return_id
  for update;

  if not found then
    raise exception 'Retur findes ikke';
  end if;

  if return_record.location_id is null then
    update public.backevent_return_lines
    set processing_status = 'requires_review',
        error_message = coalesce(error_message, 'RETURN_LOCATION_MISSING')
    where id = line_record.id;
    perform public.backevent_refresh_return_status(line_record.return_id);
    return jsonb_build_object('ok', false, 'status', 'requires_review', 'message', 'RETURN_LOCATION_MISSING');
  end if;

  if line_record.return_handling in ('manual_review') or line_record.backevent_product_id is null then
    update public.backevent_return_lines
    set processing_status = 'requires_review',
        error_message = coalesce(error_message, 'Kræver manuel kontrol')
    where id = line_record.id;
    perform public.backevent_refresh_return_status(line_record.return_id);
    return jsonb_build_object('ok', false, 'status', 'requires_review', 'message', 'Kræver manuel kontrol');
  end if;

  if line_record.return_handling = 'no_stock_effect' then
    update public.backevent_return_lines
    set processing_status = 'no_stock_effect',
        affects_stock = false,
        stock_processed_quantity = 0,
        error_message = null
    where id = line_record.id;
    perform public.backevent_refresh_return_status(line_record.return_id);
    return jsonb_build_object('ok', true, 'status', 'no_stock_effect');
  end if;

  if line_record.calculated_stock_quantity <= 0 then
    update public.backevent_return_lines
    set processing_status = 'requires_review',
        error_message = 'Antal mangler'
    where id = line_record.id;
    perform public.backevent_refresh_return_status(line_record.return_id);
    return jsonb_build_object('ok', false, 'status', 'requires_review', 'message', 'Antal mangler');
  end if;

  if line_record.return_handling = 'return_to_stock' then
    if return_record.source_location_id is null then
      update public.backevent_return_lines
      set processing_status = 'requires_review',
          error_message = 'STOCK_SOURCE_MISSING'
      where id = line_record.id;
      perform public.backevent_refresh_return_status(line_record.return_id);
      return jsonb_build_object('ok', false, 'status', 'requires_review', 'message', 'STOCK_SOURCE_MISSING');
    end if;

    insert into public.backevent_stock_balances(product_id, location_id, quantity)
    values (line_record.backevent_product_id, return_record.source_location_id, 0)
    on conflict (product_id, location_id) do nothing;

    select * into balance_record
    from public.backevent_stock_balances
    where product_id = line_record.backevent_product_id
      and location_id = return_record.source_location_id
    for update;

    quantity_after := balance_record.quantity + line_record.calculated_stock_quantity;
    update public.backevent_stock_balances
    set quantity = quantity_after,
        updated_at = now()
    where id = balance_record.id;

    insert into public.backevent_stock_adjustments (
      product_id, location_id, adjustment_type, quantity_before, quantity_after, quantity_delta, unit, note, created_by_name, return_id, return_line_id, external_reference
    )
    values (
      line_record.backevent_product_id,
      return_record.source_location_id,
      'correction',
      balance_record.quantity,
      quantity_after,
      line_record.calculated_stock_quantity,
      coalesce(line_record.unit, 'stk'),
      'OnlinePOS-retur lagt tilbage på lager: ' || coalesce(return_record.receipt_number, return_record.external_idempotency_key),
      'BackEvent',
      return_record.id,
      line_record.id,
      return_record.external_idempotency_key
    )
    returning id into adjustment_id;

    update public.backevent_return_lines
    set processing_status = 'returned_to_stock',
        affects_stock = true,
        stock_processed_quantity = line_record.calculated_stock_quantity,
        waste_adjustment_id = adjustment_id,
        error_message = null
    where id = line_record.id;

    insert into public.backevent_return_history(return_id, return_line_id, action, actor_name, metadata)
    values (
      line_record.return_id,
      line_record.id,
      'return_to_stock',
      'BackEvent',
      jsonb_build_object(
        'quantity', line_record.calculated_stock_quantity,
        'inputQuantity', line_record.returned_quantity,
        'inputUnit', line_record.input_unit,
        'locationId', return_record.source_location_id,
        'adjustmentId', adjustment_id
      )
    );
  elsif line_record.return_handling = 'waste' then
    insert into public.backevent_stock_adjustments (
      product_id, location_id, adjustment_type, quantity_before, quantity_after, quantity_delta, unit, note, created_by_name, return_id, return_line_id, external_reference
    )
    values (
      line_record.backevent_product_id,
      return_record.location_id,
      'waste',
      0,
      0,
      0,
      coalesce(line_record.input_unit, line_record.unit, 'stk'),
      'OnlinePOS-retur registreret som svind: ' || coalesce(return_record.receipt_number, return_record.external_idempotency_key),
      'BackEvent',
      return_record.id,
      line_record.id,
      return_record.external_idempotency_key
    )
    returning id into adjustment_id;

    update public.backevent_return_lines
    set processing_status = 'waste_registered',
        affects_stock = false,
        stock_processed_quantity = 0,
        waste_registered_quantity = line_record.calculated_stock_quantity,
        waste_adjustment_id = adjustment_id,
        error_message = null
    where id = line_record.id;

    insert into public.backevent_return_history(return_id, return_line_id, action, actor_name, metadata)
    values (
      line_record.return_id,
      line_record.id,
      'waste_registered',
      'BackEvent',
      jsonb_build_object(
        'quantity', line_record.calculated_stock_quantity,
        'inputQuantity', line_record.returned_quantity,
        'inputUnit', line_record.input_unit,
        'adjustmentId', adjustment_id
      )
    );
  else
    update public.backevent_return_lines
    set processing_status = 'requires_review',
        error_message = 'Ukendt returhåndtering'
    where id = line_record.id;
  end if;

  perform public.backevent_refresh_return_status(line_record.return_id);
  return jsonb_build_object('ok', true, 'status', (select processing_status from public.backevent_return_lines where id = line_record.id));
end;
$$;

grant execute on function public.backevent_process_return_line(uuid) to authenticated;
grant execute on function public.backevent_refresh_return_status(uuid) to authenticated;
grant execute on function public.backevent_is_finance_responsible() to authenticated;

alter table public.backevent_returns enable row level security;
alter table public.backevent_return_lines enable row level security;
alter table public.backevent_return_history enable row level security;
alter table public.backevent_return_notifications enable row level security;
alter table public.backevent_return_sync_runs enable row level security;
alter table public.backevent_member_groups enable row level security;
alter table public.backevent_member_group_members enable row level security;
alter table public.backevent_onlinepos_location_mappings enable row level security;

drop policy if exists "backevent finance read returns" on public.backevent_returns;
create policy "backevent finance read returns"
  on public.backevent_returns for select to authenticated
  using (public.backevent_is_finance_responsible());

drop policy if exists "backevent owner write returns" on public.backevent_returns;
create policy "backevent owner write returns"
  on public.backevent_returns for all to authenticated
  using (public.backevent_is_owner())
  with check (public.backevent_is_owner());

drop policy if exists "backevent finance read return lines" on public.backevent_return_lines;
create policy "backevent finance read return lines"
  on public.backevent_return_lines for select to authenticated
  using (public.backevent_is_finance_responsible());

drop policy if exists "backevent owner write return lines" on public.backevent_return_lines;
create policy "backevent owner write return lines"
  on public.backevent_return_lines for all to authenticated
  using (public.backevent_is_owner())
  with check (public.backevent_is_owner());

drop policy if exists "backevent finance read return history" on public.backevent_return_history;
create policy "backevent finance read return history"
  on public.backevent_return_history for select to authenticated
  using (public.backevent_is_finance_responsible());

drop policy if exists "backevent owner write return history" on public.backevent_return_history;
create policy "backevent owner write return history"
  on public.backevent_return_history for all to authenticated
  using (public.backevent_is_owner())
  with check (public.backevent_is_owner());

drop policy if exists "backevent owner read return notifications" on public.backevent_return_notifications;
create policy "backevent owner read return notifications"
  on public.backevent_return_notifications for select to authenticated
  using (public.backevent_is_owner());

drop policy if exists "backevent owner write return notifications" on public.backevent_return_notifications;
create policy "backevent owner write return notifications"
  on public.backevent_return_notifications for all to authenticated
  using (public.backevent_is_owner())
  with check (public.backevent_is_owner());

drop policy if exists "backevent owner read return sync runs" on public.backevent_return_sync_runs;
create policy "backevent owner read return sync runs"
  on public.backevent_return_sync_runs for select to authenticated
  using (public.backevent_is_owner());

drop policy if exists "backevent owner write return sync runs" on public.backevent_return_sync_runs;
create policy "backevent owner write return sync runs"
  on public.backevent_return_sync_runs for all to authenticated
  using (public.backevent_is_owner())
  with check (public.backevent_is_owner());

drop policy if exists "backevent owner insert member groups" on public.backevent_member_groups;
create policy "backevent owner insert member groups"
  on public.backevent_member_groups for insert to authenticated
  with check (public.backevent_is_owner());

drop policy if exists "backevent owner update member groups" on public.backevent_member_groups;
create policy "backevent owner update member groups"
  on public.backevent_member_groups for update to authenticated
  using (public.backevent_is_owner())
  with check (public.backevent_is_owner());

drop policy if exists "backevent owner delete member groups" on public.backevent_member_groups;
create policy "backevent owner delete member groups"
  on public.backevent_member_groups for delete to authenticated
  using (public.backevent_is_owner());

drop policy if exists "backevent owner insert member group memberships" on public.backevent_member_group_members;
create policy "backevent owner insert member group memberships"
  on public.backevent_member_group_members for insert to authenticated
  with check (public.backevent_is_owner());

drop policy if exists "backevent owner delete member group memberships" on public.backevent_member_group_members;
create policy "backevent owner delete member group memberships"
  on public.backevent_member_group_members for delete to authenticated
  using (public.backevent_is_owner());

drop policy if exists "backevent owner read onlinepos location mappings" on public.backevent_onlinepos_location_mappings;
create policy "backevent owner read onlinepos location mappings"
  on public.backevent_onlinepos_location_mappings for select to authenticated
  using (public.backevent_is_owner());

drop policy if exists "backevent owner insert onlinepos location mappings" on public.backevent_onlinepos_location_mappings;
create policy "backevent owner insert onlinepos location mappings"
  on public.backevent_onlinepos_location_mappings for insert to authenticated
  with check (public.backevent_is_owner());

drop policy if exists "backevent owner update onlinepos location mappings" on public.backevent_onlinepos_location_mappings;
create policy "backevent owner update onlinepos location mappings"
  on public.backevent_onlinepos_location_mappings for update to authenticated
  using (public.backevent_is_owner())
  with check (public.backevent_is_owner());

drop policy if exists "backevent owner delete onlinepos location mappings" on public.backevent_onlinepos_location_mappings;
create policy "backevent owner delete onlinepos location mappings"
  on public.backevent_onlinepos_location_mappings for delete to authenticated
  using (public.backevent_is_owner());
