create table if not exists public.backevent_stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.backevent_products(id),
  location_id uuid references public.backevent_locations(id),
  adjustment_type text not null check (adjustment_type in ('correction', 'waste')),
  quantity_before numeric not null,
  quantity_after numeric not null,
  quantity_delta numeric not null,
  unit text default 'kasser',
  note text null,
  created_by_name text null,
  created_at timestamptz default now()
);

create index if not exists idx_backevent_stock_adjustments_created_at
  on public.backevent_stock_adjustments(created_at desc);

create index if not exists idx_backevent_stock_adjustments_location
  on public.backevent_stock_adjustments(location_id);

create index if not exists idx_backevent_stock_adjustments_product
  on public.backevent_stock_adjustments(product_id);

create or replace function public.backevent_create_stock_adjustment(
  p_product_id uuid,
  p_location_id uuid,
  p_adjustment_type text,
  p_quantity_delta numeric default null,
  p_new_quantity numeric default null,
  p_unit text default 'kasser',
  p_note text default null,
  p_created_by_name text default null
)
returns uuid
language plpgsql
as $$
declare
  v_adjustment_id uuid;
  v_before numeric;
  v_after numeric;
  v_delta numeric;
begin
  if p_adjustment_type not in ('correction', 'waste') then
    raise exception 'Ukendt rettelse';
  end if;

  insert into public.backevent_stock_balances (product_id, location_id, quantity)
  values (p_product_id, p_location_id, 0)
  on conflict (product_id, location_id) do nothing;

  select quantity
  into v_before
  from public.backevent_stock_balances
  where product_id = p_product_id
    and location_id = p_location_id
  for update;

  if p_adjustment_type = 'correction' then
    if p_new_quantity is null then
      raise exception 'Nyt antal mangler';
    end if;

    v_after := p_new_quantity;
    v_delta := v_after - v_before;
  else
    if p_quantity_delta is null or p_quantity_delta <= 0 then
      raise exception 'Svind skal være større end 0';
    end if;

    v_delta := -p_quantity_delta;
    v_after := v_before + v_delta;
  end if;

  update public.backevent_stock_balances
  set quantity = v_after,
      updated_at = now()
  where product_id = p_product_id
    and location_id = p_location_id;

  insert into public.backevent_stock_adjustments (
    product_id,
    location_id,
    adjustment_type,
    quantity_before,
    quantity_after,
    quantity_delta,
    unit,
    note,
    created_by_name
  )
  values (
    p_product_id,
    p_location_id,
    p_adjustment_type,
    v_before,
    v_after,
    v_delta,
    coalesce(p_unit, 'kasser'),
    p_note,
    p_created_by_name
  )
  returning id into v_adjustment_id;

  return v_adjustment_id;
end;
$$;
