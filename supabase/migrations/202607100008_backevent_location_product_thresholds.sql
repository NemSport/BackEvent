create table if not exists public.backevent_location_product_thresholds (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.backevent_locations(id) on delete cascade,
  product_id uuid not null references public.backevent_products(id) on delete cascade,
  low_threshold numeric null,
  critical_threshold numeric null,
  alerts_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint backevent_location_product_thresholds_unique unique (location_id, product_id),
  constraint backevent_location_product_thresholds_non_negative check (
    (low_threshold is null or low_threshold >= 0)
    and (critical_threshold is null or critical_threshold >= 0)
  ),
  constraint backevent_location_product_thresholds_order check (
    low_threshold is null
    or critical_threshold is null
    or critical_threshold <= low_threshold
  )
);

alter table public.backevent_location_product_thresholds
  add column if not exists location_id uuid references public.backevent_locations(id) on delete cascade;

alter table public.backevent_location_product_thresholds
  add column if not exists product_id uuid references public.backevent_products(id) on delete cascade;

alter table public.backevent_location_product_thresholds
  add column if not exists low_threshold numeric null;

alter table public.backevent_location_product_thresholds
  add column if not exists critical_threshold numeric null;

alter table public.backevent_location_product_thresholds
  add column if not exists alerts_enabled boolean not null default true;

alter table public.backevent_location_product_thresholds
  add column if not exists created_at timestamptz not null default now();

alter table public.backevent_location_product_thresholds
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists idx_backevent_location_product_thresholds_location_product
  on public.backevent_location_product_thresholds(location_id, product_id);

create index if not exists idx_backevent_location_product_thresholds_product
  on public.backevent_location_product_thresholds(product_id);

create index if not exists idx_backevent_location_product_thresholds_alerts_enabled
  on public.backevent_location_product_thresholds(alerts_enabled);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.backevent_location_product_thresholds'::regclass
      and conname = 'backevent_location_product_thresholds_non_negative'
  ) then
    alter table public.backevent_location_product_thresholds
      add constraint backevent_location_product_thresholds_non_negative check (
        (low_threshold is null or low_threshold >= 0)
        and (critical_threshold is null or critical_threshold >= 0)
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.backevent_location_product_thresholds'::regclass
      and conname = 'backevent_location_product_thresholds_order'
  ) then
    alter table public.backevent_location_product_thresholds
      add constraint backevent_location_product_thresholds_order check (
        low_threshold is null
        or critical_threshold is null
        or critical_threshold <= low_threshold
      );
  end if;
end;
$$;

create or replace function public.backevent_touch_location_product_thresholds()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists backevent_touch_location_product_thresholds on public.backevent_location_product_thresholds;
create trigger backevent_touch_location_product_thresholds
before update on public.backevent_location_product_thresholds
for each row
execute function public.backevent_touch_location_product_thresholds();

insert into public.backevent_location_product_thresholds (
  location_id,
  product_id,
  low_threshold,
  critical_threshold,
  alerts_enabled
)
select
  locations.id,
  settings.inventory_item_id,
  settings.low_threshold,
  settings.critical_threshold,
  settings.active
from public.backevent_inventory_alert_settings settings
join public.backevent_locations locations
  on locations.active = true
  and locations.type = 'container'
  and (settings.location_id is null or settings.location_id = locations.id)
where settings.active = true
on conflict (location_id, product_id) do nothing;

alter table public.backevent_location_product_thresholds enable row level security;

drop policy if exists "backevent responsible read location product thresholds" on public.backevent_location_product_thresholds;
create policy "backevent responsible read location product thresholds"
  on public.backevent_location_product_thresholds for select to authenticated
  using (public.backevent_is_responsible());

drop policy if exists "backevent responsible insert location product thresholds" on public.backevent_location_product_thresholds;
create policy "backevent responsible insert location product thresholds"
  on public.backevent_location_product_thresholds for insert to authenticated
  with check (public.backevent_is_responsible());

drop policy if exists "backevent responsible update location product thresholds" on public.backevent_location_product_thresholds;
create policy "backevent responsible update location product thresholds"
  on public.backevent_location_product_thresholds for update to authenticated
  using (public.backevent_is_responsible())
  with check (public.backevent_is_responsible());

drop policy if exists "backevent owner delete location product thresholds" on public.backevent_location_product_thresholds;
create policy "backevent owner delete location product thresholds"
  on public.backevent_location_product_thresholds for delete to authenticated
  using (public.backevent_is_owner());
