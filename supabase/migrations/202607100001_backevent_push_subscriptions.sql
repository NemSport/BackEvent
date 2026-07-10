create table if not exists public.backevent_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  endpoint text,
  p256dh text,
  auth text,
  user_agent text null,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.backevent_push_subscriptions
  add column if not exists id uuid default gen_random_uuid();

alter table public.backevent_push_subscriptions
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table public.backevent_push_subscriptions
  add column if not exists endpoint text;

alter table public.backevent_push_subscriptions
  add column if not exists p256dh text;

alter table public.backevent_push_subscriptions
  add column if not exists auth text;

alter table public.backevent_push_subscriptions
  add column if not exists user_agent text null;

alter table public.backevent_push_subscriptions
  add column if not exists active boolean default true;

alter table public.backevent_push_subscriptions
  add column if not exists created_at timestamptz default now();

alter table public.backevent_push_subscriptions
  add column if not exists updated_at timestamptz default now();

alter table public.backevent_push_subscriptions
  alter column user_id set not null,
  alter column endpoint set not null,
  alter column p256dh set not null,
  alter column auth set not null,
  alter column active set not null,
  alter column created_at set not null,
  alter column updated_at set not null;

create unique index if not exists backevent_push_subscriptions_user_endpoint_idx
  on public.backevent_push_subscriptions(user_id, endpoint);

create index if not exists idx_backevent_push_subscriptions_user
  on public.backevent_push_subscriptions(user_id);

create index if not exists idx_backevent_push_subscriptions_active
  on public.backevent_push_subscriptions(active);

create or replace function public.backevent_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists backevent_push_subscriptions_touch_updated_at on public.backevent_push_subscriptions;
create trigger backevent_push_subscriptions_touch_updated_at
  before update on public.backevent_push_subscriptions
  for each row execute function public.backevent_touch_updated_at();

alter table public.backevent_push_subscriptions enable row level security;

drop policy if exists "backevent users read own push subscriptions" on public.backevent_push_subscriptions;
create policy "backevent users read own push subscriptions"
  on public.backevent_push_subscriptions for select to authenticated
  using (user_id = auth.uid() or public.backevent_is_owner());

drop policy if exists "backevent users insert own push subscriptions" on public.backevent_push_subscriptions;
create policy "backevent users insert own push subscriptions"
  on public.backevent_push_subscriptions for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "backevent users update own push subscriptions" on public.backevent_push_subscriptions;
create policy "backevent users update own push subscriptions"
  on public.backevent_push_subscriptions for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
