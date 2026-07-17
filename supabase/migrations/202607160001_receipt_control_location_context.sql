alter table public.backevent_onlinepos_receipt_controls
  add column if not exists transaction_datetime timestamptz,
  add column if not exists location_id uuid references public.backevent_locations(id) on delete set null,
  add column if not exists location_name text,
  add column if not exists cash_register_id text,
  add column if not exists cash_register_name text,
  add column if not exists location_mapping_status text not null default 'unmapped';

alter table public.backevent_onlinepos_receipt_controls
  drop constraint if exists backevent_onlinepos_receipt_controls_location_mapping_status_check;

alter table public.backevent_onlinepos_receipt_controls
  add constraint backevent_onlinepos_receipt_controls_location_mapping_status_check
  check (location_mapping_status in ('mapped', 'unmapped'));

create index if not exists backevent_onlinepos_receipt_controls_location_id_idx
  on public.backevent_onlinepos_receipt_controls(location_id);

comment on column public.backevent_onlinepos_receipt_controls.location_name is
  'Snapshot of the matched BackEvent location name when the receipt control was created.';
comment on column public.backevent_onlinepos_receipt_controls.cash_register_name is
  'Original bar/cash-register name received from OnlinePOS.';
