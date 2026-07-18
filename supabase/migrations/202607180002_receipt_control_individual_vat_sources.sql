alter table public.backevent_onlinepos_receipt_controls
  add column if not exists purchase_value_including_vat numeric null,
  add column if not exists deposit_return_value_including_vat numeric null,
  add column if not exists final_total_including_vat numeric null,
  add column if not exists amount_source_details jsonb not null default '{}'::jsonb;

-- Existing control amounts are documented OnlinePOS receipt amounts. Preserve
-- them verbatim for presentation instead of inferring a net VAT basis from the
-- legacy amounts_include_vat default.
update public.backevent_onlinepos_receipt_controls
set
  purchase_value_including_vat = coalesce(purchase_value_including_vat, purchase_value),
  deposit_return_value_including_vat = coalesce(deposit_return_value_including_vat, deposit_return_value),
  final_total_including_vat = coalesce(final_total_including_vat, final_total),
  amount_source_details = case
    when amount_source_details = '{}'::jsonb then jsonb_build_object(
      'purchase', jsonb_build_array('legacy_documented_onlinepos_amount'),
      'depositReturn', jsonb_build_array('legacy_documented_onlinepos_amount'),
      'finalTotal', 'legacy_documented_onlinepos_amount'
    )
    else amount_source_details
  end
where
  purchase_value_including_vat is null
  or deposit_return_value_including_vat is null
  or final_total_including_vat is null
  or amount_source_details = '{}'::jsonb;

comment on column public.backevent_onlinepos_receipt_controls.amount_source_details is
  'Audit metadata describing the OnlinePOS source field used independently for purchase, deposit return, and final total display amounts.';

comment on column public.backevent_onlinepos_receipt_controls.amounts_include_vat is
  'Deprecated compatibility field. Presentation uses the three individual *_including_vat columns.';
