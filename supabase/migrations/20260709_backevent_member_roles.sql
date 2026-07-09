alter table public.backevent_profiles
  add column if not exists email text null;

do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select conname
    from pg_constraint
    where conrelid = 'public.backevent_profiles'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.backevent_profiles drop constraint if exists %I', constraint_record.conname);
  end loop;
end;
$$;

alter table public.backevent_profiles
  add constraint backevent_profiles_role_check
  check (role in ('admin', 'frivillig', 'ansvarlig', 'ejer'));

update public.backevent_profiles profiles
set email = users.email
from auth.users users
where profiles.id = users.id
  and profiles.email is null;

update public.backevent_profiles
set role = 'ejer'
where role = 'admin';

alter table public.backevent_profiles
  drop constraint if exists backevent_profiles_role_check;

alter table public.backevent_profiles
  add constraint backevent_profiles_role_check
  check (role in ('frivillig', 'ansvarlig', 'ejer'));

create or replace function public.backevent_is_owner()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.backevent_profiles
    where id = auth.uid()
      and role in ('ejer', 'admin')
      and active = true
  );
$$;

create or replace function public.backevent_is_responsible()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.backevent_profiles
    where id = auth.uid()
      and role in ('ansvarlig', 'ejer', 'admin')
      and active = true
  );
$$;

create or replace function public.backevent_is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.backevent_is_owner();
$$;

create or replace function public.backevent_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.backevent_profiles (id, full_name, email, role)
  values (
    new.id,
    nullif(coalesce(new.raw_user_meta_data->>'full_name', new.email), ''),
    new.email,
    'frivillig'
  )
  on conflict (id) do update
  set email = coalesce(public.backevent_profiles.email, excluded.email),
      full_name = coalesce(public.backevent_profiles.full_name, excluded.full_name);
  return new;
end;
$$;

drop policy if exists "backevent profiles read own or admin" on public.backevent_profiles;
create policy "backevent profiles read own or admin"
  on public.backevent_profiles
  for select
  to authenticated
  using (id = auth.uid() or public.backevent_is_owner());

drop policy if exists "backevent profiles admin update" on public.backevent_profiles;
create policy "backevent profiles admin update"
  on public.backevent_profiles
  for update
  to authenticated
  using (public.backevent_is_owner())
  with check (public.backevent_is_owner());

drop policy if exists "backevent read balances" on public.backevent_stock_balances;
create policy "backevent read balances"
  on public.backevent_stock_balances for select to authenticated
  using (public.backevent_is_responsible());

drop policy if exists "backevent read movements" on public.backevent_stock_movements;
create policy "backevent read movements"
  on public.backevent_stock_movements for select to authenticated
  using (public.backevent_is_responsible());

drop policy if exists "backevent read statuses" on public.backevent_opening_closing_statuses;
create policy "backevent read statuses"
  on public.backevent_opening_closing_statuses for select to authenticated
  using (public.backevent_is_responsible());

drop policy if exists "backevent read status lines" on public.backevent_opening_closing_lines;
create policy "backevent read status lines"
  on public.backevent_opening_closing_lines for select to authenticated
  using (public.backevent_is_responsible());

drop policy if exists "backevent read adjustments" on public.backevent_stock_adjustments;
create policy "backevent read adjustments"
  on public.backevent_stock_adjustments for select to authenticated
  using (public.backevent_is_responsible());

drop policy if exists "backevent admin insert adjustments" on public.backevent_stock_adjustments;
create policy "backevent admin insert adjustments"
  on public.backevent_stock_adjustments for insert to authenticated
  with check (public.backevent_is_responsible());

drop policy if exists "backevent admin insert products" on public.backevent_products;
create policy "backevent admin insert products"
  on public.backevent_products for insert to authenticated
  with check (public.backevent_is_owner());

drop policy if exists "backevent admin update products" on public.backevent_products;
create policy "backevent admin update products"
  on public.backevent_products for update to authenticated
  using (public.backevent_is_owner())
  with check (public.backevent_is_owner());

drop policy if exists "backevent admin insert locations" on public.backevent_locations;
create policy "backevent admin insert locations"
  on public.backevent_locations for insert to authenticated
  with check (public.backevent_is_owner());

drop policy if exists "backevent admin update locations" on public.backevent_locations;
create policy "backevent admin update locations"
  on public.backevent_locations for update to authenticated
  using (public.backevent_is_owner())
  with check (public.backevent_is_owner());

drop policy if exists "backevent admin read onlinepos inventory mappings" on public.onlinepos_inventory_mappings;
create policy "backevent admin read onlinepos inventory mappings"
  on public.onlinepos_inventory_mappings for select to authenticated
  using (public.backevent_is_owner());

drop policy if exists "backevent admin insert onlinepos inventory mappings" on public.onlinepos_inventory_mappings;
create policy "backevent admin insert onlinepos inventory mappings"
  on public.onlinepos_inventory_mappings for insert to authenticated
  with check (public.backevent_is_owner());

drop policy if exists "backevent admin update onlinepos inventory mappings" on public.onlinepos_inventory_mappings;
create policy "backevent admin update onlinepos inventory mappings"
  on public.onlinepos_inventory_mappings for update to authenticated
  using (public.backevent_is_owner())
  with check (public.backevent_is_owner());

drop policy if exists "backevent admin read onlinepos inventory mapping components" on public.onlinepos_inventory_mapping_components;
create policy "backevent admin read onlinepos inventory mapping components"
  on public.onlinepos_inventory_mapping_components for select to authenticated
  using (public.backevent_is_owner());

drop policy if exists "backevent admin insert onlinepos inventory mapping components" on public.onlinepos_inventory_mapping_components;
create policy "backevent admin insert onlinepos inventory mapping components"
  on public.onlinepos_inventory_mapping_components for insert to authenticated
  with check (public.backevent_is_owner());

drop policy if exists "backevent admin update onlinepos inventory mapping components" on public.onlinepos_inventory_mapping_components;
create policy "backevent admin update onlinepos inventory mapping components"
  on public.onlinepos_inventory_mapping_components for update to authenticated
  using (public.backevent_is_owner())
  with check (public.backevent_is_owner());

drop policy if exists "backevent admin delete onlinepos inventory mapping components" on public.onlinepos_inventory_mapping_components;
create policy "backevent admin delete onlinepos inventory mapping components"
  on public.onlinepos_inventory_mapping_components for delete to authenticated
  using (public.backevent_is_owner());

create or replace function public.backevent_reverse_stock_movement(
  p_movement_id uuid,
  p_reversed_by_name text default null,
  p_reversal_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_movement public.backevent_stock_movements%rowtype;
begin
  if not public.backevent_is_owner() then
    raise exception 'Kun ejer kan gøre dette';
  end if;

  select * into v_movement
  from public.backevent_stock_movements
  where id = p_movement_id
  for update;

  if not found then
    raise exception 'Flytning blev ikke fundet';
  end if;

  if v_movement.reversed_at is not null then
    raise exception 'Flytning er allerede fortrudt';
  end if;

  insert into public.backevent_stock_balances (product_id, location_id, quantity)
  values
    (v_movement.product_id, v_movement.from_location_id, 0),
    (v_movement.product_id, v_movement.to_location_id, 0)
  on conflict (product_id, location_id) do nothing;

  update public.backevent_stock_balances
  set quantity = quantity + v_movement.quantity,
      updated_at = now()
  where product_id = v_movement.product_id
    and location_id = v_movement.from_location_id;

  update public.backevent_stock_balances
  set quantity = quantity - v_movement.quantity,
      updated_at = now()
  where product_id = v_movement.product_id
    and location_id = v_movement.to_location_id;

  update public.backevent_stock_movements
  set reversed_at = now(),
      reversed_by_name = coalesce(p_reversed_by_name, 'Ukendt'),
      reversal_reason = p_reversal_reason
  where id = p_movement_id;
end;
$$;

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
security definer
set search_path = public
as $$
declare
  v_adjustment_id uuid;
  v_before numeric;
  v_after numeric;
  v_delta numeric;
begin
  if not public.backevent_is_responsible() then
    raise exception 'Kun ansvarlig kan gøre dette';
  end if;

  if p_adjustment_type not in ('correction', 'waste') then
    raise exception 'Ukendt rettelse';
  end if;

  insert into public.backevent_stock_balances (product_id, location_id, quantity)
  values (p_product_id, p_location_id, 0)
  on conflict (product_id, location_id) do nothing;

  select quantity into v_before
  from public.backevent_stock_balances
  where product_id = p_product_id and location_id = p_location_id
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
  where product_id = p_product_id and location_id = p_location_id;

  insert into public.backevent_stock_adjustments (
    product_id, location_id, adjustment_type, quantity_before, quantity_after,
    quantity_delta, unit, note, created_by_name
  )
  values (
    p_product_id, p_location_id, p_adjustment_type, v_before, v_after, v_delta,
    coalesce(p_unit, 'kasser'), p_note, coalesce(p_created_by_name, 'Ukendt')
  )
  returning id into v_adjustment_id;

  return v_adjustment_id;
end;
$$;
