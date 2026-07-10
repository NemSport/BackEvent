create table if not exists public.backevent_inventory_alert_settings (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.backevent_products(id) on delete cascade,
  location_id uuid null references public.backevent_locations(id) on delete cascade,
  low_threshold numeric null,
  critical_threshold numeric null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(inventory_item_id, location_id)
);

alter table public.backevent_inventory_alert_settings
  add column if not exists inventory_item_id uuid references public.backevent_products(id) on delete cascade;

alter table public.backevent_inventory_alert_settings
  add column if not exists location_id uuid null references public.backevent_locations(id) on delete cascade;

alter table public.backevent_inventory_alert_settings
  add column if not exists low_threshold numeric null;

alter table public.backevent_inventory_alert_settings
  add column if not exists critical_threshold numeric null;

alter table public.backevent_inventory_alert_settings
  add column if not exists active boolean not null default true;

alter table public.backevent_inventory_alert_settings
  add column if not exists created_at timestamptz not null default now();

alter table public.backevent_inventory_alert_settings
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists idx_backevent_inventory_alert_settings_item_location
  on public.backevent_inventory_alert_settings(inventory_item_id, location_id);

create table if not exists public.backevent_inventory_alert_state (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.backevent_products(id) on delete cascade,
  location_id uuid null references public.backevent_locations(id) on delete cascade,
  alert_level text not null,
  last_sent_at timestamptz null,
  last_stock_value numeric null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint backevent_inventory_alert_state_level_check check (alert_level in ('low', 'critical'))
);

alter table public.backevent_inventory_alert_state
  add column if not exists inventory_item_id uuid references public.backevent_products(id) on delete cascade;

alter table public.backevent_inventory_alert_state
  add column if not exists location_id uuid null references public.backevent_locations(id) on delete cascade;

alter table public.backevent_inventory_alert_state
  add column if not exists alert_level text;

alter table public.backevent_inventory_alert_state
  add column if not exists last_sent_at timestamptz null;

alter table public.backevent_inventory_alert_state
  add column if not exists last_stock_value numeric null;

alter table public.backevent_inventory_alert_state
  add column if not exists created_at timestamptz not null default now();

alter table public.backevent_inventory_alert_state
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.backevent_inventory_alert_state'::regclass
      and conname = 'backevent_inventory_alert_state_level_check'
  ) then
    alter table public.backevent_inventory_alert_state
      add constraint backevent_inventory_alert_state_level_check check (alert_level in ('low', 'critical'));
  end if;
end;
$$;

create unique index if not exists idx_backevent_inventory_alert_state_item_location_level
  on public.backevent_inventory_alert_state(inventory_item_id, location_id, alert_level);

create index if not exists idx_backevent_inventory_alert_settings_active
  on public.backevent_inventory_alert_settings(active);

insert into public.backevent_member_groups (name, description, active)
select 'Lageransvarlige', 'Modtagere af lageralarmer', true
where not exists (
  select 1
  from public.backevent_member_groups
  where lower(name) = lower('Lageransvarlige')
);

insert into public.backevent_inventory_alert_settings (inventory_item_id, location_id, low_threshold, critical_threshold, active)
select
  id,
  null,
  case
    when name = 'Tuborg 33 cl' then 16
    when name = 'Tuborg Classic' then 12
    when name in ('Pepsi Max', 'Faxe Kondi') then 10
    when name = 'Vand' then 14
    when name = 'Somersby' then 8
    when name = 'Fadøl 25L' then 5
    else 10
  end,
  case
    when name = 'Tuborg 33 cl' then 8
    when name = 'Tuborg Classic' then 6
    when name in ('Pepsi Max', 'Faxe Kondi') then 5
    when name = 'Vand' then 7
    when name = 'Somersby' then 4
    when name = 'Fadøl 25L' then 2
    else 5
  end,
  true
from public.backevent_products
where tracking_mode = 'inventory'
on conflict (inventory_item_id, location_id) do nothing;

alter table public.backevent_inventory_alert_settings enable row level security;
alter table public.backevent_inventory_alert_state enable row level security;

drop policy if exists "backevent responsible read inventory alert settings" on public.backevent_inventory_alert_settings;
create policy "backevent responsible read inventory alert settings"
  on public.backevent_inventory_alert_settings for select to authenticated
  using (public.backevent_is_responsible());

drop policy if exists "backevent owner write inventory alert settings" on public.backevent_inventory_alert_settings;
create policy "backevent owner write inventory alert settings"
  on public.backevent_inventory_alert_settings for all to authenticated
  using (public.backevent_is_owner())
  with check (public.backevent_is_owner());

drop policy if exists "backevent owner read inventory alert state" on public.backevent_inventory_alert_state;
create policy "backevent owner read inventory alert state"
  on public.backevent_inventory_alert_state for select to authenticated
  using (public.backevent_is_owner());

drop policy if exists "backevent owner write inventory alert state" on public.backevent_inventory_alert_state;
create policy "backevent owner write inventory alert state"
  on public.backevent_inventory_alert_state for all to authenticated
  using (public.backevent_is_owner())
  with check (public.backevent_is_owner());
