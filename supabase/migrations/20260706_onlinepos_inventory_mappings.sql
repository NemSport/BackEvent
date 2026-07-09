create table if not exists public.onlinepos_inventory_mappings (
  id uuid primary key default gen_random_uuid(),
  onlinepos_product_id text null,
  onlinepos_product_name text null,
  onlinepos_product_group_name text null,
  line_type text not null,
  backevent_inventory_item_id uuid null references public.backevent_products(id) on delete set null,
  conversion_factor numeric null,
  mapping_action text not null default 'ignore',
  status text not null default 'unmapped',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint onlinepos_inventory_mappings_line_type_check check (
    line_type in ('modifier_stock_item', 'deposit_fee', 'deposit_return', 'container_product', 'stock_item', 'unknown')
  ),
  constraint onlinepos_inventory_mappings_action_check check (
    mapping_action in ('consume_stock', 'ignore', 'deposit_fee', 'deposit_return', 'container_only')
  ),
  constraint onlinepos_inventory_mappings_status_check check (
    status in ('unmapped', 'approved')
  )
);

create unique index if not exists onlinepos_inventory_mappings_identity_idx
  on public.onlinepos_inventory_mappings (
    coalesce(onlinepos_product_id, ''),
    coalesce(onlinepos_product_name, ''),
    coalesce(onlinepos_product_group_name, ''),
    line_type
  );

create index if not exists onlinepos_inventory_mappings_status_idx
  on public.onlinepos_inventory_mappings (status);

create index if not exists onlinepos_inventory_mappings_inventory_item_idx
  on public.onlinepos_inventory_mappings (backevent_inventory_item_id)
  where backevent_inventory_item_id is not null;

create or replace function public.backevent_touch_onlinepos_inventory_mapping()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists onlinepos_inventory_mappings_touch_updated_at on public.onlinepos_inventory_mappings;
create trigger onlinepos_inventory_mappings_touch_updated_at
  before update on public.onlinepos_inventory_mappings
  for each row execute function public.backevent_touch_onlinepos_inventory_mapping();

alter table public.onlinepos_inventory_mappings enable row level security;

drop policy if exists "backevent admin read onlinepos inventory mappings" on public.onlinepos_inventory_mappings;
create policy "backevent admin read onlinepos inventory mappings"
  on public.onlinepos_inventory_mappings for select to authenticated
  using (public.backevent_is_admin());

drop policy if exists "backevent admin insert onlinepos inventory mappings" on public.onlinepos_inventory_mappings;
create policy "backevent admin insert onlinepos inventory mappings"
  on public.onlinepos_inventory_mappings for insert to authenticated
  with check (public.backevent_is_admin());

drop policy if exists "backevent admin update onlinepos inventory mappings" on public.onlinepos_inventory_mappings;
create policy "backevent admin update onlinepos inventory mappings"
  on public.onlinepos_inventory_mappings for update to authenticated
  using (public.backevent_is_admin())
  with check (public.backevent_is_admin());
