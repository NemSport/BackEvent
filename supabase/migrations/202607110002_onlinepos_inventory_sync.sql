create table if not exists public.onlinepos_inventory_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'manual',
  datetime_from timestamptz not null,
  datetime_to timestamptz not null,
  status text not null default 'running' check (status in ('running', 'completed', 'partial', 'failed')),
  fetched_count integer not null default 0,
  processed_count integer not null default 0,
  ignored_count integer not null default 0,
  failed_count integer not null default 0,
  missing_mapping_count integer not null default 0,
  duplicate_count integer not null default 0,
  error_message text null,
  created_by_user_id uuid null references auth.users(id) on delete set null,
  created_by_email text null,
  started_at timestamptz not null default now(),
  finished_at timestamptz null
);

create table if not exists public.onlinepos_inventory_sync_lines (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.onlinepos_inventory_sync_runs(id) on delete cascade,
  external_line_id text not null,
  transaction_id text null,
  receipt_number text null,
  line_id text null,
  onlinepos_product_id text null,
  onlinepos_product_name text null,
  onlinepos_product_group_name text null,
  cash_register_id text null,
  cash_register_name text null,
  line_type text not null,
  mapping_id uuid null references public.onlinepos_inventory_mappings(id) on delete set null,
  mapping_status text null,
  mapping_action text null,
  status text not null check (status in ('processed', 'ignored', 'failed')),
  error_reason text null,
  location_id uuid null references public.backevent_locations(id) on delete set null,
  source_location_id uuid null references public.backevent_locations(id) on delete set null,
  quantity_sold numeric not null default 0,
  stock_delta numeric not null default 0,
  applied_components jsonb not null default '[]'::jsonb,
  revenue numeric not null default 0,
  component_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (external_line_id)
);

create index if not exists idx_onlinepos_inventory_sync_runs_started
  on public.onlinepos_inventory_sync_runs(started_at desc);

create index if not exists idx_onlinepos_inventory_sync_lines_run
  on public.onlinepos_inventory_sync_lines(run_id);

create index if not exists idx_onlinepos_inventory_sync_lines_status
  on public.onlinepos_inventory_sync_lines(status);

alter table public.onlinepos_inventory_sync_runs enable row level security;
alter table public.onlinepos_inventory_sync_lines enable row level security;

drop policy if exists "onlinepos inventory sync runs owner read" on public.onlinepos_inventory_sync_runs;
create policy "onlinepos inventory sync runs owner read"
  on public.onlinepos_inventory_sync_runs for select to authenticated
  using (public.backevent_is_owner());

drop policy if exists "onlinepos inventory sync lines owner read" on public.onlinepos_inventory_sync_lines;
create policy "onlinepos inventory sync lines owner read"
  on public.onlinepos_inventory_sync_lines for select to authenticated
  using (public.backevent_is_owner());

create or replace function public.backevent_apply_onlinepos_inventory_sync(
  p_run_id uuid,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line jsonb;
  v_component jsonb;
  v_external_line_id text;
  v_status text;
  v_inserted_id uuid;
  v_product_id uuid;
  v_location_id uuid;
  v_quantity numeric;
  v_before numeric;
  v_processed integer := 0;
  v_ignored integer := 0;
  v_failed integer := 0;
  v_duplicate integer := 0;
begin
  if p_run_id is null then
    raise exception 'Sync run mangler';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Linjer mangler';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_external_line_id := nullif(v_line->>'externalLineId', '');
    v_status := coalesce(nullif(v_line->>'status', ''), 'ignored');
    v_inserted_id := null;

    if v_external_line_id is null then
      raise exception 'Ekstern linje-ID mangler';
    end if;

    insert into public.onlinepos_inventory_sync_lines (
      run_id,
      external_line_id,
      transaction_id,
      receipt_number,
      line_id,
      onlinepos_product_id,
      onlinepos_product_name,
      onlinepos_product_group_name,
      cash_register_id,
      cash_register_name,
      line_type,
      mapping_id,
      mapping_status,
      mapping_action,
      status,
      error_reason,
      location_id,
      source_location_id,
      quantity_sold,
      stock_delta,
      applied_components,
      revenue,
      component_count
    )
    values (
      p_run_id,
      v_external_line_id,
      nullif(v_line->>'transactionId', ''),
      nullif(v_line->>'receiptNumber', ''),
      nullif(v_line->>'lineId', ''),
      nullif(v_line->>'onlineposProductId', ''),
      nullif(v_line->>'onlineposProductName', ''),
      nullif(v_line->>'onlineposProductGroupName', ''),
      nullif(v_line->>'cashRegisterId', ''),
      nullif(v_line->>'cashRegisterName', ''),
      coalesce(nullif(v_line->>'lineType', ''), 'unknown'),
      nullif(v_line->>'mappingId', '')::uuid,
      nullif(v_line->>'mappingStatus', ''),
      nullif(v_line->>'mappingAction', ''),
      case when v_status in ('processed', 'ignored', 'failed') then v_status else 'failed' end,
      nullif(v_line->>'errorReason', ''),
      nullif(v_line->>'locationId', '')::uuid,
      nullif(v_line->>'sourceLocationId', '')::uuid,
      coalesce(nullif(v_line->>'quantitySold', '')::numeric, 0),
      coalesce(nullif(v_line->>'stockDelta', '')::numeric, 0),
      coalesce(v_line->'components', '[]'::jsonb),
      coalesce(nullif(v_line->>'revenue', '')::numeric, 0),
      coalesce(jsonb_array_length(coalesce(v_line->'components', '[]'::jsonb)), 0)
    )
    on conflict (external_line_id) do nothing
    returning id into v_inserted_id;

    if v_inserted_id is null then
      v_duplicate := v_duplicate + 1;
      continue;
    end if;

    if v_status = 'processed' then
      for v_component in select * from jsonb_array_elements(coalesce(v_line->'components', '[]'::jsonb))
      loop
        v_product_id := nullif(v_component->>'productId', '')::uuid;
        v_location_id := nullif(v_component->>'locationId', '')::uuid;
        v_quantity := nullif(v_component->>'quantity', '')::numeric;

        if v_product_id is null or v_location_id is null or v_quantity is null or v_quantity <= 0 then
          raise exception 'Ugyldig lagerkomponent for OnlinePOS linje %', v_external_line_id;
        end if;

        insert into public.backevent_stock_balances (product_id, location_id, quantity)
        values (v_product_id, v_location_id, 0)
        on conflict (product_id, location_id) do nothing;

        select quantity
        into v_before
        from public.backevent_stock_balances
        where product_id = v_product_id
          and location_id = v_location_id
        for update;

        update public.backevent_stock_balances
        set quantity = quantity - v_quantity,
            updated_at = now()
        where product_id = v_product_id
          and location_id = v_location_id;
      end loop;

      v_processed := v_processed + 1;
    elsif v_status = 'failed' then
      v_failed := v_failed + 1;
    else
      v_ignored := v_ignored + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'processedCount', v_processed,
    'ignoredCount', v_ignored,
    'failedCount', v_failed,
    'duplicateCount', v_duplicate
  );
end;
$$;

grant execute on function public.backevent_apply_onlinepos_inventory_sync(uuid, jsonb) to authenticated;
