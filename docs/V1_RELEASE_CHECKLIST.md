# BackEvent V1 releasecheckliste

Udfør punkterne i rækkefølge. Indsæt aldrig secrets eller deres værdier i dokumentet, git eller release-noter.

- [ ] 1. Kontrollér hele git-diffen og at kun den aftalte releasepakke er med.
- [ ] 2. Kontrollér branch og forskel mod dens remote tracking branch.
- [ ] 3. Kontrollér Vercel environment variables mod `.env.example` med `npm.cmd run preflight -- --production`.
- [ ] 4. Kontrollér remote migrationsstatus uden at omskrive allerede anvendte migrationer.
- [ ] 5. Anvend de manglende migrationer i filrækkefølge.
- [ ] 6. Verificér migrationernes tabeller, funktioner, RLS, grants og revokes.
- [ ] 7. Commit den gennemgåede releasepakke.
- [ ] 8. Push den aftalte branch.
- [ ] 9. Kontrollér at Vercel-buildet passerer uden manglende environment variables.
- [ ] 10. Kontrollér cron-konfiguration, autorisation og første dokumenterede kørsel.
- [ ] 11. Udfør den rollebaserede test i `docs/V1_SMOKE_TEST.md`.
- [ ] 12. Udfør den manuelle push-test på mindst én rigtig browser/enhed.
- [ ] 13. Kontrollér serverlogs, notifikationsresultater og at lageret kun er påvirket som forventet.
- [ ] 14. Godkend releasen, eller rollback efter den aftalte rollbackplan.
