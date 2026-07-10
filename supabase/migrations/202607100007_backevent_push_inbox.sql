create table if not exists public.backevent_push_messages (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_email text null,
  sender_user_id uuid null references auth.users(id) on delete set null,
  sender_name text null,
  group_id uuid null references public.backevent_member_groups(id) on delete set null,
  title text not null,
  body text not null,
  target_url text not null default '/notifikationer',
  category text not null default 'general',
  read_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint backevent_push_messages_category_check check (category in ('general','group','inventory_alert','test'))
);

alter table public.backevent_push_messages
  add column if not exists id uuid default gen_random_uuid();

alter table public.backevent_push_messages
  add column if not exists recipient_user_id uuid references auth.users(id) on delete cascade;

alter table public.backevent_push_messages
  add column if not exists recipient_email text null;

alter table public.backevent_push_messages
  add column if not exists sender_user_id uuid null references auth.users(id) on delete set null;

alter table public.backevent_push_messages
  add column if not exists sender_name text null;

alter table public.backevent_push_messages
  add column if not exists group_id uuid null references public.backevent_member_groups(id) on delete set null;

alter table public.backevent_push_messages
  add column if not exists title text;

alter table public.backevent_push_messages
  add column if not exists body text;

alter table public.backevent_push_messages
  add column if not exists target_url text default '/notifikationer';

alter table public.backevent_push_messages
  add column if not exists category text default 'general';

alter table public.backevent_push_messages
  add column if not exists read_at timestamptz null;

alter table public.backevent_push_messages
  add column if not exists created_at timestamptz default now();

alter table public.backevent_push_messages
  alter column recipient_user_id set not null,
  alter column title set not null,
  alter column body set not null,
  alter column target_url set not null,
  alter column category set not null,
  alter column created_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.backevent_push_messages'::regclass
      and conname = 'backevent_push_messages_category_check'
  ) then
    alter table public.backevent_push_messages
      add constraint backevent_push_messages_category_check check (category in ('general','group','inventory_alert','test'));
  end if;
end;
$$;

create index if not exists idx_backevent_push_messages_recipient_created
  on public.backevent_push_messages(recipient_user_id, created_at desc);

create index if not exists idx_backevent_push_messages_recipient_unread
  on public.backevent_push_messages(recipient_user_id)
  where read_at is null;

create index if not exists idx_backevent_push_messages_group
  on public.backevent_push_messages(group_id);

alter table public.backevent_push_messages enable row level security;

drop policy if exists "backevent users read own push messages" on public.backevent_push_messages;
create policy "backevent users read own push messages"
  on public.backevent_push_messages for select to authenticated
  using (recipient_user_id = auth.uid());

drop policy if exists "backevent users update own push messages" on public.backevent_push_messages;
create policy "backevent users update own push messages"
  on public.backevent_push_messages for update to authenticated
  using (recipient_user_id = auth.uid())
  with check (recipient_user_id = auth.uid());

drop policy if exists "backevent responsible insert push messages" on public.backevent_push_messages;
create policy "backevent responsible insert push messages"
  on public.backevent_push_messages for insert to authenticated
  with check (
    exists (
      select 1
      from public.backevent_profiles p
      where p.id = auth.uid()
        and p.active = true
        and p.role in ('ansvarlig', 'ejer')
    )
  );

drop policy if exists "backevent users delete own push subscriptions" on public.backevent_push_subscriptions;
create policy "backevent users delete own push subscriptions"
  on public.backevent_push_subscriptions for delete to authenticated
  using (user_id = auth.uid());
