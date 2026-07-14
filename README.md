# BackEvent

BackEvent er det interne driftsværktøj til eventlager, åbning og lukning, vareflytninger, OnlinePOS-synkronisering, returer, bonkontrol og driftsnotifikationer.

## Lokal opstart

1. Installér dependencies med `npm install`.
2. Kopiér `.env.example` til `.env.local`, og udfyld kun de nødvendige lokale værdier.
3. Kør `npm.cmd run preflight`.
4. Start appen med `npm.cmd run dev`.

## Environment og preflight

Kopiér variabelnavnene fra `.env.example`; filen indeholder ingen virkelige secrets.

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` og `NEXT_PUBLIC_VAPID_PUBLIC_KEY` er de eneste klientvariabler.
- `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT` og alle OnlinePOS-credentials er server-only.
- Canonical OnlinePOS concern-navn er `ONLINEPOS_CONCERN`.
- Canonical public VAPID-navn er `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.
- `ONLINEPOS_CONCERN_ID`, `WEB_PUSH_PUBLIC_KEY` og `NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY` er ikke længere understøttet.

Kør lokal kontrol uden at vise værdier:

```powershell
npm.cmd run preflight
```

Kør den strenge produktionskontrol før deploy:

```powershell
npm.cmd run preflight -- --production
```

## Vercel Cron

`vercel.json` kalder inventory alerts, OnlinePOS sync og return sync hvert tiende minut. Alle cronroutes kræver `Authorization: Bearer <CRON_SECRET>` eller `x-cron-secret: <CRON_SECRET>`.

## Push og notifikationer

Driftsbeskeder gemmes i den interne indbakke. Web Push kræver den offentlige VAPID-nøgle på klienten samt privat nøgle og subject på serveren. Supabase Auth-mails til invitation, login og password reset er fortsat en del af autentifikationen; BackEvent sender ikke driftsmails.

## Roller

- `Frivillig` bruger de almindelige driftsflows.
- `Ansvarlig` har udvidet lager- og historikadgang.
- `Ejer` administrerer opsætning, integrationer og ejerbeskyttede værktøjer.
- Aktivt medlemskab af gruppen `Økonomiansvarlige` giver adgang til bonkontrol.

Adgang håndhæves både i UI, API og databasepolitikker/funktioner, hvor det er relevant.

## Migrationer

Migrationer ligger i `supabase/migrations` og skal anvendes i filrækkefølge. Kontrollér remote migrationsstatus før deploy, og omskriv ikke migrationer, der allerede er anvendt. Release-rækkefølgen findes i `docs/V1_RELEASE_CHECKLIST.md`.

## Validering

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

Den manuelle rolle-, push- og lagerkontrol findes i `docs/V1_SMOKE_TEST.md`.
