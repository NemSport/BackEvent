create extension if not exists pgcrypto;

create table if not exists public.backevent_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null,
  is_main_storage boolean default false,
  sort_order int not null,
  active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.backevent_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit text default 'kasser',
  units_per_case int null,
  sort_order int not null,
  active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.backevent_stock_balances (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.backevent_products(id) on delete cascade,
  location_id uuid references public.backevent_locations(id) on delete cascade,
  quantity numeric default 0,
  updated_at timestamptz default now(),
  unique(product_id, location_id)
);

create table if not exists public.backevent_stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.backevent_products(id),
  from_location_id uuid references public.backevent_locations(id),
  to_location_id uuid references public.backevent_locations(id),
  quantity numeric not null,
  unit text default 'kasser',
  note text null,
  created_by_name text null,
  created_at timestamptz default now(),
  reversed_at timestamptz null,
  reversed_by_name text null,
  reversal_reason text null
);

create table if not exists public.backevent_opening_closing_statuses (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references public.backevent_locations(id),
  status_type text check (status_type in ('opening', 'closing')),
  status_date date default current_date,
  created_by_name text null,
  created_at timestamptz default now()
);

create table if not exists public.backevent_opening_closing_lines (
  id uuid primary key default gen_random_uuid(),
  status_id uuid references public.backevent_opening_closing_statuses(id) on delete cascade,
  product_id uuid references public.backevent_products(id),
  quantity numeric not null,
  unit text default 'kasser'
);

create index if not exists idx_backevent_locations_active_sort
  on public.backevent_locations(active, sort_order);

create index if not exists idx_backevent_products_active_sort
  on public.backevent_products(active, sort_order);

create index if not exists idx_backevent_stock_balances_location
  on public.backevent_stock_balances(location_id);

create index if not exists idx_backevent_stock_balances_product
  on public.backevent_stock_balances(product_id);

create index if not exists idx_backevent_stock_movements_created_at
  on public.backevent_stock_movements(created_at desc);

create index if not exists idx_backevent_stock_movements_product
  on public.backevent_stock_movements(product_id);

create index if not exists idx_backevent_stock_movements_from_location
  on public.backevent_stock_movements(from_location_id);

create index if not exists idx_backevent_stock_movements_to_location
  on public.backevent_stock_movements(to_location_id);

create index if not exists idx_backevent_opening_closing_statuses_location_date
  on public.backevent_opening_closing_statuses(location_id, status_date desc);

create index if not exists idx_backevent_opening_closing_lines_status
  on public.backevent_opening_closing_lines(status_id);

insert into public.backevent_locations (name, type, is_main_storage, sort_order)
values
  ('Blå Container (Hovedlager)', 'container', true, 1),
  ('Rød Container', 'container', false, 2),
  ('Grøn Container', 'container', false, 3),
  ('Pub Container', 'bar', false, 4),
  ('Street Container', 'bar', false, 5);

insert into public.backevent_products (name, unit, units_per_case, sort_order)
values
  ('Tuborg 33 cl', 'kasser', 30, 1),
  ('Tuborg Classic', 'kasser', 30, 2),
  ('Pepsi Max', 'kasser', 24, 3),
  ('Faxe Kondi', 'kasser', 24, 4),
  ('Vand', 'kasser', 24, 5),
  ('Somersby', 'kasser', 24, 6),
  ('Fadøl 25L', 'fustager', null, 7);

insert into public.backevent_stock_balances (location_id, product_id, quantity)
select
  locations.id,
  products.id,
  case
    when locations.name = 'Blå Container (Hovedlager)' and products.name = 'Tuborg 33 cl' then 96
    when locations.name = 'Blå Container (Hovedlager)' and products.name = 'Tuborg Classic' then 54
    when locations.name = 'Blå Container (Hovedlager)' and products.name = 'Pepsi Max' then 38
    when locations.name = 'Blå Container (Hovedlager)' and products.name = 'Faxe Kondi' then 42
    when locations.name = 'Blå Container (Hovedlager)' and products.name = 'Vand' then 64
    when locations.name = 'Blå Container (Hovedlager)' and products.name = 'Somersby' then 24
    when locations.name = 'Blå Container (Hovedlager)' and products.name = 'Fadøl 25L' then 18
    when locations.name = 'Rød Container' and products.name = 'Tuborg 33 cl' then 18
    when locations.name = 'Rød Container' and products.name = 'Tuborg Classic' then 9
    when locations.name = 'Rød Container' and products.name = 'Pepsi Max' then 7
    when locations.name = 'Rød Container' and products.name = 'Faxe Kondi' then 11
    when locations.name = 'Rød Container' and products.name = 'Vand' then 16
    when locations.name = 'Rød Container' and products.name = 'Somersby' then 6
    when locations.name = 'Rød Container' and products.name = 'Fadøl 25L' then 3
    when locations.name = 'Grøn Container' and products.name = 'Tuborg 33 cl' then 8
    when locations.name = 'Grøn Container' and products.name = 'Tuborg Classic' then 5
    when locations.name = 'Grøn Container' and products.name = 'Pepsi Max' then 4
    when locations.name = 'Grøn Container' and products.name = 'Faxe Kondi' then 8
    when locations.name = 'Grøn Container' and products.name = 'Vand' then 11
    when locations.name = 'Grøn Container' and products.name = 'Somersby' then 3
    when locations.name = 'Grøn Container' and products.name = 'Fadøl 25L' then 2
    when locations.name = 'Pub Container' and products.name = 'Tuborg 33 cl' then 12
    when locations.name = 'Pub Container' and products.name = 'Tuborg Classic' then 10
    when locations.name = 'Pub Container' and products.name = 'Pepsi Max' then 6
    when locations.name = 'Pub Container' and products.name = 'Faxe Kondi' then 5
    when locations.name = 'Pub Container' and products.name = 'Vand' then 10
    when locations.name = 'Pub Container' and products.name = 'Somersby' then 7
    when locations.name = 'Pub Container' and products.name = 'Fadøl 25L' then 4
    when locations.name = 'Street Container' and products.name = 'Tuborg 33 cl' then 22
    when locations.name = 'Street Container' and products.name = 'Tuborg Classic' then 12
    when locations.name = 'Street Container' and products.name = 'Pepsi Max' then 14
    when locations.name = 'Street Container' and products.name = 'Faxe Kondi' then 18
    when locations.name = 'Street Container' and products.name = 'Vand' then 20
    when locations.name = 'Street Container' and products.name = 'Somersby' then 6
    when locations.name = 'Street Container' and products.name = 'Fadøl 25L' then 5
    else 0
  end
from public.backevent_locations locations
cross join public.backevent_products products;

create or replace function public.backevent_create_stock_movement(
  p_product_id uuid,
  p_from_location_id uuid,
  p_to_location_id uuid,
  p_quantity numeric,
  p_unit text default 'kasser',
  p_note text default null,
  p_created_by_name text default null
)
returns uuid
language plpgsql
as $$
declare
  v_movement_id uuid;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Antal skal være større end 0';
  end if;

  if p_from_location_id = p_to_location_id then
    raise exception 'Fra og til skal være forskellige steder';
  end if;

  insert into public.backevent_stock_balances (product_id, location_id, quantity)
  values
    (p_product_id, p_from_location_id, 0),
    (p_product_id, p_to_location_id, 0)
  on conflict (product_id, location_id) do nothing;

  update public.backevent_stock_balances
  set quantity = quantity - p_quantity,
      updated_at = now()
  where product_id = p_product_id
    and location_id = p_from_location_id;

  update public.backevent_stock_balances
  set quantity = quantity + p_quantity,
      updated_at = now()
  where product_id = p_product_id
    and location_id = p_to_location_id;

  insert into public.backevent_stock_movements (
    product_id,
    from_location_id,
    to_location_id,
    quantity,
    unit,
    note,
    created_by_name
  )
  values (
    p_product_id,
    p_from_location_id,
    p_to_location_id,
    p_quantity,
    coalesce(p_unit, 'kasser'),
    p_note,
    p_created_by_name
  )
  returning id into v_movement_id;

  return v_movement_id;
end;
$$;

create or replace function public.backevent_reverse_stock_movement(
  p_movement_id uuid,
  p_reversed_by_name text default null,
  p_reversal_reason text default null
)
returns void
language plpgsql
as $$
declare
  v_movement public.backevent_stock_movements%rowtype;
begin
  select *
  into v_movement
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
      reversed_by_name = p_reversed_by_name,
      reversal_reason = p_reversal_reason
  where id = p_movement_id;
end;
$$;
