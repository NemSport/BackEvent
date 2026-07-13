create table if not exists public.backevent_onlinepos_location_mappings (
  id uuid primary key default gen_random_uuid(),
  onlinepos_venue_id text null,
  onlinepos_cash_register_id text null,
  onlinepos_cash_register_name text not null,
  normalized_cash_register_name text not null,
  backevent_location_id uuid not null references public.backevent_locations(id) on delete restrict,
  active boolean not null default true,
  first_seen_at timestamptz null,
  last_seen_at timestamptz null,
  created_by uuid null references auth.users(id) on delete set null,
  updated_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists backevent_onlinepos_location_mappings_id_unique
  on public.backevent_onlinepos_location_mappings (
    coalesce(onlinepos_venue_id, ''),
    onlinepos_cash_register_id
  )
  where onlinepos_cash_register_id is not null;

create unique index if not exists backevent_onlinepos_location_mappings_name_unique
  on public.backevent_onlinepos_location_mappings (
    coalesce(onlinepos_venue_id, ''),
    normalized_cash_register_name
  )
  where onlinepos_cash_register_id is null;

create index if not exists backevent_onlinepos_location_mappings_location_idx
  on public.backevent_onlinepos_location_mappings(backevent_location_id);

create index if not exists backevent_onlinepos_location_mappings_active_idx
  on public.backevent_onlinepos_location_mappings(active);

create or replace function public.backevent_touch_onlinepos_location_mapping_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists backevent_touch_onlinepos_location_mapping_updated_at
  on public.backevent_onlinepos_location_mappings;

create trigger backevent_touch_onlinepos_location_mapping_updated_at
  before update on public.backevent_onlinepos_location_mappings
  for each row
  execute function public.backevent_touch_onlinepos_location_mapping_updated_at();

alter table public.backevent_onlinepos_location_mappings enable row level security;

drop policy if exists "backevent owner read onlinepos location mappings" on public.backevent_onlinepos_location_mappings;
create policy "backevent owner read onlinepos location mappings"
  on public.backevent_onlinepos_location_mappings for select to authenticated
  using (public.backevent_is_owner());

drop policy if exists "backevent owner insert onlinepos location mappings" on public.backevent_onlinepos_location_mappings;
create policy "backevent owner insert onlinepos location mappings"
  on public.backevent_onlinepos_location_mappings for insert to authenticated
  with check (public.backevent_is_owner());

drop policy if exists "backevent owner update onlinepos location mappings" on public.backevent_onlinepos_location_mappings;
create policy "backevent owner update onlinepos location mappings"
  on public.backevent_onlinepos_location_mappings for update to authenticated
  using (public.backevent_is_owner())
  with check (public.backevent_is_owner());

drop policy if exists "backevent owner delete onlinepos location mappings" on public.backevent_onlinepos_location_mappings;
create policy "backevent owner delete onlinepos location mappings"
  on public.backevent_onlinepos_location_mappings for delete to authenticated
  using (public.backevent_is_owner());
