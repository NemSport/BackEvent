create table if not exists public.backevent_onlinepos_replay_classifications (
  id uuid primary key default gen_random_uuid(),
  replay_key text not null unique,
  venue_id text null,
  transaction_id text null,
  receipt_number text null,
  cash_register_id text null,
  cash_register_name text null,
  classification text not null,
  reason text null,
  created_by uuid null references auth.users(id) on delete set null,
  updated_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint backevent_onlinepos_replay_classification_check check (
    classification in ('sale', 'return', 'void', 'ignored_testdata')
  )
);

create index if not exists backevent_onlinepos_replay_classifications_venue_idx
  on public.backevent_onlinepos_replay_classifications(venue_id);

create index if not exists backevent_onlinepos_replay_classifications_lookup_idx
  on public.backevent_onlinepos_replay_classifications(transaction_id, receipt_number);

create or replace function public.backevent_touch_onlinepos_replay_classification_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists backevent_touch_onlinepos_replay_classification_updated_at
  on public.backevent_onlinepos_replay_classifications;

create trigger backevent_touch_onlinepos_replay_classification_updated_at
  before update on public.backevent_onlinepos_replay_classifications
  for each row execute function public.backevent_touch_onlinepos_replay_classification_updated_at();

alter table public.backevent_onlinepos_replay_classifications enable row level security;

drop policy if exists "backevent owner read onlinepos replay classifications"
  on public.backevent_onlinepos_replay_classifications;
create policy "backevent owner read onlinepos replay classifications"
  on public.backevent_onlinepos_replay_classifications for select to authenticated
  using (public.backevent_is_owner());

drop policy if exists "backevent owner insert onlinepos replay classifications"
  on public.backevent_onlinepos_replay_classifications;
create policy "backevent owner insert onlinepos replay classifications"
  on public.backevent_onlinepos_replay_classifications for insert to authenticated
  with check (public.backevent_is_owner());

drop policy if exists "backevent owner update onlinepos replay classifications"
  on public.backevent_onlinepos_replay_classifications;
create policy "backevent owner update onlinepos replay classifications"
  on public.backevent_onlinepos_replay_classifications for update to authenticated
  using (public.backevent_is_owner())
  with check (public.backevent_is_owner());
