alter table public.backevent_onlinepos_receipt_controls
  add column if not exists amounts_include_vat boolean not null default false;

comment on column public.backevent_onlinepos_receipt_controls.amounts_include_vat is
  'True only when the stored receipt-control amounts were sourced from explicit OnlinePOS gross-price fields. Existing rows default to false and are converted for presentation.';
