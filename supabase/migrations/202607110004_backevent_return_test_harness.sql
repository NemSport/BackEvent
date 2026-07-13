alter table public.backevent_returns
  add column if not exists test_scenario text null,
  add column if not exists created_by uuid null references auth.users(id) on delete set null,
  add column if not exists created_by_name text null;

create index if not exists backevent_returns_test_harness_idx
  on public.backevent_returns(source, test_scenario, created_at desc)
  where source = 'test_harness';
