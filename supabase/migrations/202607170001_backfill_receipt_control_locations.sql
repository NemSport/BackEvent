-- Backfill only from the exact OnlinePOS transaction id. Receipt numbers are
-- reused across bars and are therefore not safe join keys.
with ranked_sync_context as (
  select
    control.id as receipt_control_id,
    sync_line.cash_register_id,
    sync_line.cash_register_name,
    sync_line.location_id,
    location.name as location_name,
    row_number() over (
      partition by control.id
      order by sync_line.created_at desc, sync_line.id desc
    ) as row_number
  from public.backevent_onlinepos_receipt_controls control
  join public.onlinepos_inventory_sync_lines sync_line
    on sync_line.transaction_id = control.onlinepos_transaction_id
  left join public.backevent_locations location
    on location.id = sync_line.location_id
  where control.cash_register_id is null
     or control.cash_register_name is null
     or control.location_id is null
),
sync_context as (
  select *
  from ranked_sync_context
  where row_number = 1
)
update public.backevent_onlinepos_receipt_controls control
set
  cash_register_id = coalesce(control.cash_register_id, sync_context.cash_register_id),
  cash_register_name = coalesce(control.cash_register_name, sync_context.cash_register_name),
  location_id = coalesce(control.location_id, sync_context.location_id),
  location_name = coalesce(control.location_name, sync_context.location_name),
  location_mapping_status = case
    when coalesce(control.location_id, sync_context.location_id) is not null then 'mapped'
    else 'unmapped'
  end
from sync_context
where control.id = sync_context.receipt_control_id;

comment on table public.backevent_onlinepos_receipt_controls is
  'OnlinePOS receipt controls with original cash-register context and a snapshot of the safely mapped BackEvent location.';
