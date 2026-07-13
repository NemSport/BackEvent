create or replace function public.backevent_process_return_line(p_return_line_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  line_record public.backevent_return_lines%rowtype;
  return_record public.backevent_returns%rowtype;
  balance_record public.backevent_stock_balances%rowtype;
  adjustment_id uuid;
  quantity_after numeric;
begin
  if auth.role() <> 'service_role' and not public.backevent_is_owner() then
    raise exception 'Kun ejer kan behandle retur';
  end if;

  select * into line_record
  from public.backevent_return_lines
  where id = p_return_line_id
  for update;

  if not found then
    raise exception 'Returlinje findes ikke';
  end if;

  if line_record.processing_status in ('returned_to_stock', 'waste_registered', 'no_stock_effect', 'ignored', 'processed') then
    return jsonb_build_object('ok', true, 'status', line_record.processing_status, 'alreadyProcessed', true);
  end if;

  select * into return_record
  from public.backevent_returns
  where id = line_record.return_id
  for update;

  if line_record.return_handling in ('manual_review') or line_record.backevent_product_id is null then
    update public.backevent_return_lines
    set processing_status = 'requires_review',
        error_message = coalesce(error_message, 'Kræver manuel kontrol')
    where id = line_record.id;
    perform public.backevent_refresh_return_status(line_record.return_id);
    return jsonb_build_object('ok', false, 'status', 'requires_review', 'message', 'Kræver manuel kontrol');
  end if;

  if line_record.return_handling = 'no_stock_effect' then
    update public.backevent_return_lines
    set processing_status = 'no_stock_effect',
        affects_stock = false
    where id = line_record.id;
    perform public.backevent_refresh_return_status(line_record.return_id);
    return jsonb_build_object('ok', true, 'status', 'no_stock_effect');
  end if;

  if line_record.calculated_stock_quantity <= 0 then
    update public.backevent_return_lines
    set processing_status = 'requires_review',
        error_message = 'Antal mangler'
    where id = line_record.id;
    perform public.backevent_refresh_return_status(line_record.return_id);
    return jsonb_build_object('ok', false, 'status', 'requires_review', 'message', 'Antal mangler');
  end if;

  if line_record.return_handling = 'return_to_stock' then
    if return_record.source_location_id is null then
      update public.backevent_return_lines
      set processing_status = 'requires_review',
          error_message = 'STOCK_SOURCE_MISSING'
      where id = line_record.id;
      perform public.backevent_refresh_return_status(line_record.return_id);
      return jsonb_build_object('ok', false, 'status', 'requires_review', 'message', 'STOCK_SOURCE_MISSING');
    end if;

    insert into public.backevent_stock_balances(product_id, location_id, quantity)
    values (line_record.backevent_product_id, return_record.source_location_id, 0)
    on conflict (product_id, location_id) do nothing;

    select * into balance_record
    from public.backevent_stock_balances
    where product_id = line_record.backevent_product_id
      and location_id = return_record.source_location_id
    for update;

    quantity_after := balance_record.quantity + line_record.calculated_stock_quantity;
    update public.backevent_stock_balances
    set quantity = quantity_after,
        updated_at = now()
    where id = balance_record.id;

    insert into public.backevent_stock_adjustments (
      product_id, location_id, adjustment_type, quantity_before, quantity_after, quantity_delta, unit, note, created_by_name, return_id, return_line_id, external_reference
    )
    values (
      line_record.backevent_product_id,
      return_record.source_location_id,
      'correction',
      balance_record.quantity,
      quantity_after,
      line_record.calculated_stock_quantity,
      coalesce(line_record.unit, 'stk'),
      'OnlinePOS-retur lagt tilbage på lager: ' || coalesce(return_record.receipt_number, return_record.external_idempotency_key),
      'BackEvent',
      return_record.id,
      line_record.id,
      return_record.external_idempotency_key
    )
    returning id into adjustment_id;

    update public.backevent_return_lines
    set processing_status = 'returned_to_stock',
        affects_stock = true,
        stock_processed_quantity = line_record.calculated_stock_quantity,
        waste_adjustment_id = adjustment_id,
        error_message = null
    where id = line_record.id;

    insert into public.backevent_return_history(return_id, return_line_id, action, actor_name, metadata)
    values (
      line_record.return_id,
      line_record.id,
      'return_to_stock',
      'BackEvent',
      jsonb_build_object(
        'quantity', line_record.calculated_stock_quantity,
        'inputQuantity', line_record.returned_quantity,
        'inputUnit', line_record.input_unit,
        'locationId', return_record.source_location_id,
        'adjustmentId', adjustment_id
      )
    );
  elsif line_record.return_handling = 'waste' then
    -- Retur-svind is a control/audit registration only. It must never reduce
    -- available stock; ordinary manual waste still uses backevent_create_stock_adjustment.
    insert into public.backevent_stock_adjustments (
      product_id, location_id, adjustment_type, quantity_before, quantity_after, quantity_delta, unit, note, created_by_name, return_id, return_line_id, external_reference
    )
    values (
      line_record.backevent_product_id,
      coalesce(return_record.location_id, return_record.source_location_id),
      'waste',
      0,
      0,
      0,
      coalesce(line_record.input_unit, line_record.unit, 'stk'),
      'OnlinePOS-retur registreret som svind: ' || coalesce(return_record.receipt_number, return_record.external_idempotency_key),
      'BackEvent',
      return_record.id,
      line_record.id,
      return_record.external_idempotency_key
    )
    returning id into adjustment_id;

    update public.backevent_return_lines
    set processing_status = 'waste_registered',
        affects_stock = false,
        stock_processed_quantity = 0,
        waste_registered_quantity = line_record.calculated_stock_quantity,
        waste_adjustment_id = adjustment_id,
        error_message = null
    where id = line_record.id;

    insert into public.backevent_return_history(return_id, return_line_id, action, actor_name, metadata)
    values (
      line_record.return_id,
      line_record.id,
      'waste_registered',
      'BackEvent',
      jsonb_build_object(
        'quantity', line_record.calculated_stock_quantity,
        'inputQuantity', line_record.returned_quantity,
        'inputUnit', line_record.input_unit,
        'adjustmentId', adjustment_id
      )
    );
  else
    update public.backevent_return_lines
    set processing_status = 'requires_review',
        error_message = 'Ukendt returhåndtering'
    where id = line_record.id;
  end if;

  perform public.backevent_refresh_return_status(line_record.return_id);
  return jsonb_build_object('ok', true, 'status', (select processing_status from public.backevent_return_lines where id = line_record.id));
end;
$$;

grant execute on function public.backevent_process_return_line(uuid) to authenticated;
