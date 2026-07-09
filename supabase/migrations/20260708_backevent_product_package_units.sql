alter table public.backevent_products
  add column if not exists purchase_unit_label text null,
  add column if not exists units_per_purchase_unit numeric null,
  add column if not exists stock_unit_label text null,
  add column if not exists content_per_stock_unit numeric null,
  add column if not exists consumption_unit_label text null;

update public.backevent_products
set
  purchase_unit_label = coalesce(purchase_unit_label, unit, 'kasser'),
  units_per_purchase_unit = coalesce(units_per_purchase_unit, units_per_case, 1),
  stock_unit_label = coalesce(stock_unit_label, unit, 'kasser'),
  content_per_stock_unit = coalesce(content_per_stock_unit, 1),
  consumption_unit_label = coalesce(consumption_unit_label, unit, 'kasser')
where purchase_unit_label is null
  or units_per_purchase_unit is null
  or stock_unit_label is null
  or content_per_stock_unit is null
  or consumption_unit_label is null;
