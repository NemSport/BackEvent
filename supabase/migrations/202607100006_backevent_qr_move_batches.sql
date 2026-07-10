create table if not exists public.backevent_stock_movement_batches (
  id uuid primary key default gen_random_uuid(),
  from_location_id uuid not null references public.backevent_locations(id),
  to_location_id uuid not null references public.backevent_locations(id),
  source text not null default 'manual',
  created_by_name text null,
  created_at timestamptz not null default now()
);

alter table public.backevent_stock_movement_batches
  add column if not exists from_location_id uuid references public.backevent_locations(id);

alter table public.backevent_stock_movement_batches
  add column if not exists to_location_id uuid references public.backevent_locations(id);

alter table public.backevent_stock_movement_batches
  add column if not exists source text not null default 'manual';

alter table public.backevent_stock_movement_batches
  add column if not exists created_by_name text null;

alter table public.backevent_stock_movement_batches
  add column if not exists created_at timestamptz not null default now();

alter table public.backevent_stock_movements
  add column if not exists batch_id uuid null references public.backevent_stock_movement_batches(id) on delete set null;

alter table public.backevent_stock_movements
  add column if not exists source text not null default 'manual';

create index if not exists idx_backevent_stock_movement_batches_created_at
  on public.backevent_stock_movement_batches(created_at desc);

create index if not exists idx_backevent_stock_movements_batch
  on public.backevent_stock_movements(batch_id);

alter table public.backevent_stock_movement_batches enable row level security;

drop policy if exists "backevent read movement batches" on public.backevent_stock_movement_batches;
create policy "backevent read movement batches"
  on public.backevent_stock_movement_batches for select to authenticated
  using (public.backevent_is_active_user());

create or replace function public.backevent_create_stock_movement_batch(
  p_from_location_id uuid,
  p_to_location_id uuid,
  p_lines jsonb,
  p_created_by_name text,
  p_source text default 'qr'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_line jsonb;
  v_product_id uuid;
  v_quantity numeric;
  v_unit text;
  v_available numeric;
begin
  if p_from_location_id is null or p_to_location_id is null then
    raise exception 'Fra og til mangler';
  end if;

  if p_from_location_id = p_to_location_id then
    raise exception 'Fra og til skal være forskellige steder';
  end if;

  if p_created_by_name is null or length(trim(p_created_by_name)) < 2 then
    raise exception 'Navn mangler';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Vælg mindst én vare';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_product_id := nullif(v_line->>'productId', '')::uuid;
    v_quantity := nullif(v_line->>'quantity', '')::numeric;

    if v_product_id is null or v_quantity is null or v_quantity <= 0 then
      raise exception 'Ugyldig varelinje';
    end if;

    insert into public.backevent_stock_balances (product_id, location_id, quantity)
    values
      (v_product_id, p_from_location_id, 0),
      (v_product_id, p_to_location_id, 0)
    on conflict (product_id, location_id) do nothing;

    select quantity
    into v_available
    from public.backevent_stock_balances
    where product_id = v_product_id
      and location_id = p_from_location_id
    for update;

    if v_available is null then
      raise exception 'Beholdning blev ikke fundet';
    end if;

    if v_quantity > v_available then
      raise exception 'Der er ikke nok på lager';
    end if;
  end loop;

  insert into public.backevent_stock_movement_batches (
    from_location_id,
    to_location_id,
    source,
    created_by_name
  )
  values (
    p_from_location_id,
    p_to_location_id,
    coalesce(nullif(trim(p_source), ''), 'qr'),
    trim(p_created_by_name)
  )
  returning id into v_batch_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_product_id := nullif(v_line->>'productId', '')::uuid;
    v_quantity := nullif(v_line->>'quantity', '')::numeric;
    v_unit := coalesce(nullif(v_line->>'unit', ''), 'kasser');

    update public.backevent_stock_balances
    set quantity = quantity - v_quantity,
        updated_at = now()
    where product_id = v_product_id
      and location_id = p_from_location_id;

    update public.backevent_stock_balances
    set quantity = quantity + v_quantity,
        updated_at = now()
    where product_id = v_product_id
      and location_id = p_to_location_id;

    insert into public.backevent_stock_movements (
      batch_id,
      product_id,
      from_location_id,
      to_location_id,
      quantity,
      unit,
      note,
      created_by_name,
      source
    )
    values (
      v_batch_id,
      v_product_id,
      p_from_location_id,
      p_to_location_id,
      v_quantity,
      v_unit,
      'QR samlet flytning',
      trim(p_created_by_name),
      coalesce(nullif(trim(p_source), ''), 'qr')
    );
  end loop;

  return v_batch_id;
end;
$$;

grant execute on function public.backevent_create_stock_movement_batch(uuid, uuid, jsonb, text, text) to anon, authenticated;
