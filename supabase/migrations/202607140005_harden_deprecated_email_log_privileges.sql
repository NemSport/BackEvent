-- Keep historical operational e-mail logs available to authorized signed-in users,
-- but remove every table-level write or schema privilege from client roles.
revoke all privileges on table public.backevent_email_logs from anon, authenticated;
grant select on table public.backevent_email_logs to authenticated;
