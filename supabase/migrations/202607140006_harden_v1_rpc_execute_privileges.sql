-- Supabase may retain default PUBLIC/anon execute grants on functions.
-- Make the intended V1 execution boundaries explicit.
revoke execute on function public.backevent_create_stock_movement_batch(uuid, uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.backevent_create_stock_movement_batch(uuid, uuid, jsonb, text, text) to service_role;

revoke execute on function public.backevent_apply_onlinepos_inventory_sync(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.backevent_apply_onlinepos_inventory_sync(uuid, jsonb) to service_role;

revoke execute on function public.backevent_can_manage_receipt_controls() from public, anon;
grant execute on function public.backevent_can_manage_receipt_controls() to authenticated;

revoke execute on function public.backevent_handle_receipt_control(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.backevent_handle_receipt_control(uuid, text, text, timestamptz) to authenticated;
