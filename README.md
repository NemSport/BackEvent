# BackEvent

## Environment variables

Required for Supabase-backed runtime:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Required for server-side cron jobs that must read/write through RLS-protected tables:

- `SUPABASE_SERVICE_ROLE_KEY`

Required for Vercel Cron inventory alerts:

- `CRON_SECRET`

Required for push notifications:

- `WEB_PUSH_PUBLIC_KEY` or `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- `WEB_PUSH_PRIVATE_KEY`
- `WEB_PUSH_SUBJECT`

## Vercel Cron

`vercel.json` runs:

- `/api/cron/inventory-alerts` every 10 minutes

The cron endpoint requires `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret: <CRON_SECRET>`.
