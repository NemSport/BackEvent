create table if not exists public.onlinepos_inventory_mapping_components (
  id uuid primary key default gen_random_uuid(),
  mapping_id uuid not null references public.onlinepos_inventory_mappings(id) on delete cascade,
  backevent_inventory_item_id uuid null references public.backevent_products(id) on delete set null,
  conversion_factor numeric not null,
  sort_order integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists onlinepos_inventory_mapping_components_mapping_idx
  on public.onlinepos_inventory_mapping_components (mapping_id, sort_order);

create index if not exists onlinepos_inventory_mapping_components_inventory_item_idx
  on public.onlinepos_inventory_mapping_components (backevent_inventory_item_id)
  where backevent_inventory_item_id is not null;

create or replace function public.backevent_touch_onlinepos_inventory_mapping_component()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists onlinepos_inventory_mapping_components_touch_updated_at on public.onlinepos_inventory_mapping_components;
create trigger onlinepos_inventory_mapping_components_touch_updated_at
  before update on public.onlinepos_inventory_mapping_components
  for each row execute function public.backevent_touch_onlinepos_inventory_mapping_component();

alter table public.onlinepos_inventory_mapping_components enable row level security;

drop policy if exists "backevent admin read onlinepos inventory mapping components" on public.onlinepos_inventory_mapping_components;
create policy "backevent admin read onlinepos inventory mapping components"
  on public.onlinepos_inventory_mapping_components for select to authenticated
  using (public.backevent_is_admin());

drop policy if exists "backevent admin insert onlinepos inventory mapping components" on public.onlinepos_inventory_mapping_components;
create policy "backevent admin insert onlinepos inventory mapping components"
  on public.onlinepos_inventory_mapping_components for insert to authenticated
  with check (public.backevent_is_admin());

drop policy if exists "backevent admin update onlinepos inventory mapping components" on public.onlinepos_inventory_mapping_components;
create policy "backevent admin update onlinepos inventory mapping components"
  on public.onlinepos_inventory_mapping_components for update to authenticated
  using (public.backevent_is_admin())
  with check (public.backevent_is_admin());

drop policy if exists "backevent admin delete onlinepos inventory mapping components" on public.onlinepos_inventory_mapping_components;
create policy "backevent admin delete onlinepos inventory mapping components"
  on public.onlinepos_inventory_mapping_components for delete to authenticated
  using (public.backevent_is_admin());

insert into public.onlinepos_inventory_mapping_components (
  mapping_id,
  backevent_inventory_item_id,
  conversion_factor,
  sort_order
)
select
  mappings.id,
  mappings.backevent_inventory_item_id,
  coalesce(mappings.conversion_factor, 1),
  0
from public.onlinepos_inventory_mappings mappings
where mappings.backevent_inventory_item_id is not null
  and mappings.conversion_factor is not null
  and not exists (
    select 1
    from public.onlinepos_inventory_mapping_components components
    where components.mapping_id = mappings.id
  );
