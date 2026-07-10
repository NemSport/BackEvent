alter table public.backevent_push_logs
  add column if not exists sender_user_id uuid null references auth.users(id) on delete set null;

alter table public.backevent_push_logs
  add column if not exists recipient_scope jsonb not null default '{}'::jsonb;

create index if not exists idx_backevent_push_logs_sender
  on public.backevent_push_logs(sender_user_id, created_at desc);
