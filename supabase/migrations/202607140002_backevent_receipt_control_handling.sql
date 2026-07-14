alter table public.backevent_onlinepos_receipt_controls
  add column if not exists handled_by uuid null references auth.users(id) on delete set null,
  add column if not exists handled_by_name text null,
  add column if not exists handled_at timestamptz null,
  add column if not exists internal_note text null;

alter table public.backevent_onlinepos_receipt_controls drop constraint if exists backevent_onlinepos_receipt_controls_status_check;
update public.backevent_onlinepos_receipt_controls set status = 'approved' where status = 'resolved';
update public.backevent_onlinepos_receipt_controls set status = 'confirmed_error' where status = 'dismissed';
alter table public.backevent_onlinepos_receipt_controls add constraint backevent_onlinepos_receipt_controls_status_check
  check (status in ('open','follow_up','approved','confirmed_error','test'));

create table if not exists public.backevent_onlinepos_receipt_control_audit (
  id uuid primary key default gen_random_uuid(),
  receipt_control_id uuid not null references public.backevent_onlinepos_receipt_controls(id) on delete cascade,
  previous_status text not null,
  status text not null,
  internal_note text null,
  handled_by uuid null references auth.users(id) on delete set null,
  handled_by_name text not null,
  created_at timestamptz not null default now()
);
create index if not exists backevent_receipt_control_audit_control_idx
  on public.backevent_onlinepos_receipt_control_audit(receipt_control_id, created_at desc);

alter table public.backevent_onlinepos_receipt_control_notifications add column if not exists handled_at timestamptz null;
alter table public.backevent_push_messages add column if not exists resolved_at timestamptz null;

create or replace function public.backevent_can_manage_receipt_controls()
returns boolean language sql stable security definer set search_path = public as $$
  select public.backevent_is_owner() or exists (
    select 1
    from public.backevent_member_group_members memberships
    join public.backevent_member_groups groups on groups.id = memberships.group_id
    join public.backevent_profiles profiles on profiles.id = memberships.profile_id
    where memberships.profile_id = auth.uid()
      and profiles.active = true
      and groups.active = true
      and lower(groups.name) = lower('Økonomiansvarlige')
  );
$$;
revoke all on function public.backevent_can_manage_receipt_controls() from public;
grant execute on function public.backevent_can_manage_receipt_controls() to authenticated;

drop policy if exists "backevent finance read onlinepos receipt controls" on public.backevent_onlinepos_receipt_controls;
create policy "backevent finance read onlinepos receipt controls" on public.backevent_onlinepos_receipt_controls
  for select to authenticated using (public.backevent_can_manage_receipt_controls());

drop policy if exists "backevent finance read onlinepos receipt control notifications" on public.backevent_onlinepos_receipt_control_notifications;
create policy "backevent finance read onlinepos receipt control notifications" on public.backevent_onlinepos_receipt_control_notifications
  for select to authenticated using (public.backevent_can_manage_receipt_controls());

alter table public.backevent_onlinepos_receipt_control_audit enable row level security;
drop policy if exists "backevent finance read receipt control audit" on public.backevent_onlinepos_receipt_control_audit;
create policy "backevent finance read receipt control audit" on public.backevent_onlinepos_receipt_control_audit
  for select to authenticated using (public.backevent_can_manage_receipt_controls());

drop policy if exists "backevent finance update onlinepos receipt controls" on public.backevent_onlinepos_receipt_controls;
create policy "backevent finance update onlinepos receipt controls" on public.backevent_onlinepos_receipt_controls
  for update to authenticated using (public.backevent_can_manage_receipt_controls()) with check (public.backevent_can_manage_receipt_controls());

create or replace function public.backevent_handle_receipt_control(
  p_control_id uuid, p_action text, p_internal_note text, p_expected_updated_at timestamptz
) returns setof public.backevent_onlinepos_receipt_controls
language plpgsql security definer set search_path = public as $$
declare
  current_case public.backevent_onlinepos_receipt_controls%rowtype;
  next_status text;
  actor_name text;
  completed_at timestamptz;
begin
  if not public.backevent_can_manage_receipt_controls() then raise exception 'RECEIPT_CONTROL_FORBIDDEN'; end if;
  if p_action not in ('approve','follow_up','confirm_error','save_note') then raise exception 'RECEIPT_CONTROL_INVALID_ACTION'; end if;
  select * into current_case from public.backevent_onlinepos_receipt_controls where id = p_control_id for update;
  if not found then raise exception 'RECEIPT_CONTROL_NOT_FOUND'; end if;
  next_status := case p_action when 'approve' then 'approved' when 'follow_up' then 'follow_up'
    when 'confirm_error' then 'confirmed_error' else current_case.status end;
  if current_case.updated_at is distinct from p_expected_updated_at then
    if p_action <> 'save_note' and current_case.status = next_status and coalesce(current_case.internal_note, '') = coalesce(p_internal_note, current_case.internal_note, '') then
      return query select * from public.backevent_onlinepos_receipt_controls where id = p_control_id;
      return;
    end if;
    raise exception 'RECEIPT_CONTROL_CONFLICT';
  end if;
  completed_at := case when next_status in ('approved','confirmed_error') then now() else null end;
  select coalesce(nullif(trim(full_name),''), email, 'Ukendt bruger') into actor_name
    from public.backevent_profiles where id = auth.uid();

  update public.backevent_onlinepos_receipt_controls set
    status = next_status, internal_note = coalesce(p_internal_note, internal_note),
    handled_by = auth.uid(), handled_by_name = coalesce(actor_name, 'Ukendt bruger'), handled_at = now()
    where id = p_control_id;

  insert into public.backevent_onlinepos_receipt_control_audit
    (receipt_control_id, previous_status, status, internal_note, handled_by, handled_by_name)
  values (p_control_id, current_case.status, next_status, coalesce(p_internal_note, current_case.internal_note), auth.uid(), coalesce(actor_name, 'Ukendt bruger'));

  if completed_at is not null then
    update public.backevent_onlinepos_receipt_control_notifications set handled_at = completed_at where receipt_control_id = p_control_id;
    update public.backevent_push_messages set resolved_at = completed_at
      where id in (select push_message_id from public.backevent_onlinepos_receipt_control_notifications where receipt_control_id = p_control_id and push_message_id is not null);
  end if;
  return query select * from public.backevent_onlinepos_receipt_controls where id = p_control_id;
end;
$$;
revoke all on function public.backevent_handle_receipt_control(uuid,text,text,timestamptz) from public;
grant execute on function public.backevent_handle_receipt_control(uuid,text,text,timestamptz) to authenticated;
