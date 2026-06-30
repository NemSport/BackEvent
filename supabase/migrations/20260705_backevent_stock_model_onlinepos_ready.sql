alter table public.backevent_products
  add column if not exists tracking_mode text not null default 'inventory',
  add column if not exists onlinepos_product_id text null,
  add column if not exists onlinepos_name text null,
  add column if not exists sales_unit_quantity numeric not null default 1,
  add column if not exists liters_per_sale numeric null;

alter table public.backevent_products
  drop constraint if exists backevent_products_tracking_mode_check;

alter table public.backevent_products
  add constraint backevent_products_tracking_mode_check
  check (tracking_mode in ('inventory', 'flow', 'ignore'));

alter table public.backevent_locations
  add column if not exists source_location_id uuid null references public.backevent_locations(id) on delete set null;

alter table public.backevent_locations
  drop constraint if exists backevent_locations_type_check;

update public.backevent_locations
set type = 'sales_point'
where type not in ('container', 'bar', 'sales_point');

alter table public.backevent_locations
  add constraint backevent_locations_type_check
  check (type in ('container', 'bar', 'sales_point'));

update public.backevent_products
set tracking_mode = 'inventory'
where tracking_mode is null;

update public.backevent_products
set sales_unit_quantity = 1
where sales_unit_quantity is null;

create index if not exists backevent_products_tracking_mode_idx
  on public.backevent_products (tracking_mode);

create index if not exists backevent_products_onlinepos_product_id_idx
  on public.backevent_products (onlinepos_product_id)
  where onlinepos_product_id is not null;

create index if not exists backevent_locations_source_location_id_idx
  on public.backevent_locations (source_location_id)
  where source_location_id is not null;

comment on column public.backevent_products.tracking_mode is
  'inventory=subtract stock, flow=report liters only, ignore=not used in stock calculations';

comment on column public.backevent_locations.source_location_id is
  'For bars/sales points that pull stock from another location, e.g. Rødbar from Rød Container.';
