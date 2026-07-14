-- V1 hardening: stock-changing RPCs are server workflows and must not be callable
-- directly with the public anon key or an arbitrary authenticated JWT.
revoke execute on function public.backevent_create_stock_movement_batch(uuid, uuid, jsonb, text, text) from anon, authenticated;
grant execute on function public.backevent_create_stock_movement_batch(uuid, uuid, jsonb, text, text) to service_role;

revoke execute on function public.backevent_apply_onlinepos_inventory_sync(uuid, jsonb) from anon, authenticated;
grant execute on function public.backevent_apply_onlinepos_inventory_sync(uuid, jsonb) to service_role;
