insert into public.backevent_member_groups (name, description, active)
select 'Økonomiansvarlige', 'Modtager besked og læseadgang til OnlinePOS-returer.', true
where not exists (
  select 1
  from public.backevent_member_groups
  where lower(name) = lower('Økonomiansvarlige')
);

alter table public.backevent_member_groups enable row level security;
alter table public.backevent_member_group_members enable row level security;

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

drop policy if exists "backevent owner insert member group memberships" on public.backevent_member_group_members;
create policy "backevent owner insert member group memberships"
  on public.backevent_member_group_members for insert to authenticated
  with check (public.backevent_is_owner());

drop policy if exists "backevent owner delete member group memberships" on public.backevent_member_group_members;
create policy "backevent owner delete member group memberships"
  on public.backevent_member_group_members for delete to authenticated
  using (public.backevent_is_owner());
