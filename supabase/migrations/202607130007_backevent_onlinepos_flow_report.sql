alter table public.onlinepos_inventory_sync_lines
  add column if not exists transaction_datetime timestamptz null;

create index if not exists onlinepos_inventory_sync_lines_transaction_datetime_idx
  on public.onlinepos_inventory_sync_lines(transaction_datetime desc);
