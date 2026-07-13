alter table public.backevent_return_lines
  add column if not exists input_unit text null,
  add column if not exists parent_external_line_id text null;

create index if not exists idx_backevent_return_lines_parent_external
  on public.backevent_return_lines(return_id, parent_external_line_id)
  where parent_external_line_id is not null;
