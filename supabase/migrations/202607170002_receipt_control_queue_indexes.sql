alter table public.backevent_onlinepos_receipt_controls
  add column if not exists effective_datetime timestamptz
  generated always as (coalesce(transaction_datetime, created_at)) stored;

create index if not exists backevent_receipt_controls_status_created_idx
  on public.backevent_onlinepos_receipt_controls(status, created_at, id);

create index if not exists backevent_receipt_controls_location_created_idx
  on public.backevent_onlinepos_receipt_controls(location_id, created_at, id);

create index if not exists backevent_receipt_controls_source_created_idx
  on public.backevent_onlinepos_receipt_controls(source, created_at, id);

create index if not exists backevent_receipt_controls_handler_created_idx
  on public.backevent_onlinepos_receipt_controls(handled_by, created_at, id);

create index if not exists backevent_receipt_controls_handled_at_idx
  on public.backevent_onlinepos_receipt_controls(handled_at desc, id);

create index if not exists backevent_receipt_controls_effective_datetime_idx
  on public.backevent_onlinepos_receipt_controls(effective_datetime, id);

create index if not exists backevent_receipt_controls_control_types_gin_idx
  on public.backevent_onlinepos_receipt_controls using gin(control_types);
