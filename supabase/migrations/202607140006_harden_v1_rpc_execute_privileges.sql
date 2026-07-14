-- Supabase may retain default PUBLIC/anon execute grants on functions.
-- Make the intended V1 execution boundaries explicit.
create or replace function public.backevent_can_manage_receipt_controls()
returns boolean language sql stable security definer set search_path = public as $$
  select public.backevent_is_owner() or exists (
    select 1
    from public.backevent_member_group_members memberships
    join public.backevent_member_groups groups on groups.id = memberships.group_id
    join public.backevent_profiles profiles on profiles.id = memberships.profile_id
    where memberships.profile_id = auth.uid()
      and profiles.active = true
      and groups.active = true
      and lower(groups.name) = lower('Økonomiansvarlige')
  );
$$;

-- Compatibility for remote environments where migration 202607140002 was
-- recorded before the stricter function name was introduced locally.
create or replace function public.backevent_is_finance_responsible()
returns boolean language sql stable security definer set search_path = public as $$
  select public.backevent_can_manage_receipt_controls();
$$;

revoke execute on function public.backevent_create_stock_movement_batch(uuid, uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.backevent_create_stock_movement_batch(uuid, uuid, jsonb, text, text) to service_role;

revoke execute on function public.backevent_apply_onlinepos_inventory_sync(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.backevent_apply_onlinepos_inventory_sync(uuid, jsonb) to service_role;

revoke execute on function public.backevent_can_manage_receipt_controls() from public, anon;
grant execute on function public.backevent_can_manage_receipt_controls() to authenticated;

revoke execute on function public.backevent_is_finance_responsible() from public, anon;
grant execute on function public.backevent_is_finance_responsible() to authenticated;

revoke execute on function public.backevent_handle_receipt_control(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.backevent_handle_receipt_control(uuid, text, text, timestamptz) to authenticated;
