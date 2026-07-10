alter table public.backevent_push_messages
  add column if not exists deleted_at timestamptz null;

create index if not exists idx_backevent_push_messages_recipient_visible_created
  on public.backevent_push_messages(recipient_user_id, created_at desc)
  where deleted_at is null;

create index if not exists idx_backevent_push_messages_recipient_visible_unread
  on public.backevent_push_messages(recipient_user_id)
  where read_at is null and deleted_at is null;

drop policy if exists "backevent users read own push messages" on public.backevent_push_messages;
create policy "backevent users read own push messages"
  on public.backevent_push_messages for select to authenticated
  using (recipient_user_id = auth.uid() and deleted_at is null);

drop policy if exists "backevent users update own push messages" on public.backevent_push_messages;
create policy "backevent users update own push messages"
  on public.backevent_push_messages for update to authenticated
  using (recipient_user_id = auth.uid())
  with check (recipient_user_id = auth.uid());
