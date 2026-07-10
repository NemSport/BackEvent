create table if not exists public.backevent_member_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.backevent_member_groups
  add column if not exists id uuid default gen_random_uuid();

alter table public.backevent_member_groups
  add column if not exists name text;

alter table public.backevent_member_groups
  add column if not exists description text null;

alter table public.backevent_member_groups
  add column if not exists active boolean default true;

alter table public.backevent_member_groups
  add column if not exists created_at timestamptz default now();

alter table public.backevent_member_groups
  add column if not exists updated_at timestamptz default now();

alter table public.backevent_member_groups
  alter column name set not null,
  alter column active set not null,
  alter column created_at set not null,
  alter column updated_at set not null;

create table if not exists public.backevent_member_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.backevent_member_groups(id) on delete cascade,
  profile_id uuid references public.backevent_profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.backevent_member_group_members
  add column if not exists id uuid default gen_random_uuid();

alter table public.backevent_member_group_members
  add column if not exists group_id uuid references public.backevent_member_groups(id) on delete cascade;

alter table public.backevent_member_group_members
  add column if not exists profile_id uuid references public.backevent_profiles(id) on delete cascade;

alter table public.backevent_member_group_members
  add column if not exists created_at timestamptz default now();

alter table public.backevent_member_group_members
  alter column group_id set not null,
  alter column profile_id set not null,
  alter column created_at set not null;

create unique index if not exists backevent_member_group_members_unique_idx
  on public.backevent_member_group_members(group_id, profile_id);

create index if not exists idx_backevent_member_groups_active
  on public.backevent_member_groups(active);

create index if not exists idx_backevent_member_group_members_group
  on public.backevent_member_group_members(group_id);

create index if not exists idx_backevent_member_group_members_profile
  on public.backevent_member_group_members(profile_id);

drop trigger if exists backevent_member_groups_touch_updated_at on public.backevent_member_groups;
create trigger backevent_member_groups_touch_updated_at
  before update on public.backevent_member_groups
  for each row execute function public.backevent_touch_updated_at();

alter table public.backevent_member_groups enable row level security;
alter table public.backevent_member_group_members enable row level security;

drop policy if exists "backevent responsible read member groups" on public.backevent_member_groups;
create policy "backevent responsible read member groups"
  on public.backevent_member_groups for select to authenticated
  using (
    public.backevent_is_responsible()
    or exists (
      select 1
      from public.backevent_member_group_members memberships
      where memberships.group_id = backevent_member_groups.id
        and memberships.profile_id = auth.uid()
    )
  );

drop policy if exists "backevent owner insert member groups" on public.backevent_member_groups;
create policy "backevent owner insert member groups"
  on public.backevent_member_groups for insert to authenticated
  with check (public.backevent_is_owner());

drop policy if exists "backevent owner update member groups" on public.backevent_member_groups;
create policy "backevent owner update member groups"
  on public.backevent_member_groups for update to authenticated
  using (public.backevent_is_owner())
  with check (public.backevent_is_owner());

drop policy if exists "backevent owner delete member groups" on public.backevent_member_groups;
create policy "backevent owner delete member groups"
  on public.backevent_member_groups for delete to authenticated
  using (public.backevent_is_owner());

drop policy if exists "backevent read member group memberships" on public.backevent_member_group_members;
create policy "backevent read member group memberships"
  on public.backevent_member_group_members for select to authenticated
  using (public.backevent_is_responsible() or profile_id = auth.uid());

drop policy if exists "backevent owner insert member group memberships" on public.backevent_member_group_members;
create policy "backevent owner insert member group memberships"
  on public.backevent_member_group_members for insert to authenticated
  with check (public.backevent_is_owner());

drop policy if exists "backevent owner delete member group memberships" on public.backevent_member_group_members;
create policy "backevent owner delete member group memberships"
  on public.backevent_member_group_members for delete to authenticated
  using (public.backevent_is_owner());
