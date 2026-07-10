alter table public.backevent_profiles
  add column if not exists phone text null;

alter table public.backevent_profiles
  add column if not exists invitation_status text not null default 'accepted';

alter table public.backevent_profiles
  add column if not exists invitation_sent_at timestamptz null;

alter table public.backevent_profiles
  add column if not exists invitation_accepted_at timestamptz null;

alter table public.backevent_profiles
  add column if not exists last_login_at timestamptz null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.backevent_profiles'::regclass
      and conname = 'backevent_profiles_invitation_status_check'
  ) then
    alter table public.backevent_profiles
      add constraint backevent_profiles_invitation_status_check
      check (invitation_status in ('not_sent', 'pending', 'accepted'));
  end if;
end;
$$;

update public.backevent_profiles
set invitation_status = 'accepted',
    invitation_accepted_at = coalesce(invitation_accepted_at, created_at)
where invitation_status is null;

create index if not exists idx_backevent_profiles_role_active
  on public.backevent_profiles(role, active);

create index if not exists idx_backevent_profiles_invitation_status
  on public.backevent_profiles(invitation_status);

create table if not exists public.backevent_member_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid null references auth.users(id) on delete set null,
  member_user_id uuid null references auth.users(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.backevent_member_audit_logs
  add column if not exists actor_user_id uuid null references auth.users(id) on delete set null;

alter table public.backevent_member_audit_logs
  add column if not exists member_user_id uuid null references auth.users(id) on delete set null;

alter table public.backevent_member_audit_logs
  add column if not exists action text not null default 'updated';

alter table public.backevent_member_audit_logs
  add column if not exists details jsonb not null default '{}'::jsonb;

alter table public.backevent_member_audit_logs
  add column if not exists created_at timestamptz not null default now();

create index if not exists idx_backevent_member_audit_logs_member
  on public.backevent_member_audit_logs(member_user_id, created_at desc);

create index if not exists idx_backevent_member_audit_logs_actor
  on public.backevent_member_audit_logs(actor_user_id, created_at desc);

alter table public.backevent_member_audit_logs enable row level security;

drop policy if exists "backevent owner read member audit logs" on public.backevent_member_audit_logs;
create policy "backevent owner read member audit logs"
  on public.backevent_member_audit_logs for select to authenticated
  using (public.backevent_is_owner());

drop policy if exists "backevent owner insert member audit logs" on public.backevent_member_audit_logs;
create policy "backevent owner insert member audit logs"
  on public.backevent_member_audit_logs for insert to authenticated
  with check (public.backevent_is_owner());
