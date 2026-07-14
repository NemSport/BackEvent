-- BackEvent no longer uses e-mail as an operational channel.
-- Keep historical rows intact, but make the legacy log read-only and explicitly deprecated.
comment on table public.backevent_email_logs is
  'DEPRECATED: historical operational e-mail log. BackEvent uses inbox messages and Web Push only.';

revoke insert, update, delete on table public.backevent_email_logs from authenticated;

drop policy if exists "backevent owner insert email logs" on public.backevent_email_logs;
drop policy if exists "backevent owner update email logs" on public.backevent_email_logs;
