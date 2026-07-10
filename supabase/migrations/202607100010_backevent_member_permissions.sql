create table if not exists public.backevent_profile_permissions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.backevent_profiles(id) on delete cascade,
  permission_key text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint backevent_profile_permissions_unique unique (profile_id, permission_key)
);

alter table public.backevent_profile_permissions
  add column if not exists profile_id uuid references public.backevent_profiles(id) on delete cascade;

alter table public.backevent_profile_permissions
  add column if not exists permission_key text;

alter table public.backevent_profile_permissions
  add column if not exists enabled boolean not null default true;

alter table public.backevent_profile_permissions
  add column if not exists created_at timestamptz not null default now();

alter table public.backevent_profile_permissions
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists idx_backevent_profile_permissions_unique
  on public.backevent_profile_permissions(profile_id, permission_key);

create index if not exists idx_backevent_profile_permissions_profile
  on public.backevent_profile_permissions(profile_id);

create or replace function public.backevent_touch_profile_permissions()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists backevent_touch_profile_permissions on public.backevent_profile_permissions;
create trigger backevent_touch_profile_permissions
before update on public.backevent_profile_permissions
for each row
execute function public.backevent_touch_profile_permissions();

create or replace function public.backevent_has_permission(p_permission_key text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.backevent_profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.role = 'ejer'
  )
  or exists (
    select 1
    from public.backevent_profile_permissions pp
    join public.backevent_profiles p on p.id = pp.profile_id
    where pp.profile_id = auth.uid()
      and p.active = true
      and pp.permission_key = p_permission_key
      and pp.enabled = true
  );
$$;

alter table public.backevent_profile_permissions enable row level security;

drop policy if exists "backevent owner read profile permissions" on public.backevent_profile_permissions;
create policy "backevent owner read profile permissions"
  on public.backevent_profile_permissions for select to authenticated
  using (public.backevent_is_owner() or profile_id = auth.uid());

drop policy if exists "backevent owner insert profile permissions" on public.backevent_profile_permissions;
create policy "backevent owner insert profile permissions"
  on public.backevent_profile_permissions for insert to authenticated
  with check (public.backevent_is_owner());

drop policy if exists "backevent owner update profile permissions" on public.backevent_profile_permissions;
create policy "backevent owner update profile permissions"
  on public.backevent_profile_permissions for update to authenticated
  using (public.backevent_is_owner())
  with check (public.backevent_is_owner());

drop policy if exists "backevent owner delete profile permissions" on public.backevent_profile_permissions;
create policy "backevent owner delete profile permissions"
  on public.backevent_profile_permissions for delete to authenticated
  using (public.backevent_is_owner());
