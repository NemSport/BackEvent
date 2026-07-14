# BackEvent V1 smoke-test

Udfør testen efter migrationer og environment variables er anvendt i det miljø, der skal godkendes. Brug fire separate testkonti. Test aldrig med produktionslager uden en aftalt, reversibel testplan.

Statusværdier: `Ikke kørt`, `Bestået`, `Fejlet`.

## Testmiljø

| Felt | Værdi |
| --- | --- |
| Miljø/URL | |
| App-version/commit | |
| Dato og tester | |
| Browser/enhed | |
| Migrationer kontrolleret | |

## Frivillig

| Kontrol | Forventet resultat | Faktisk resultat | Status | Fejlbeskrivelse |
| --- | --- | --- | --- | --- |
| Login | Brugeren kommer til Start uden adminmenu | | Ikke kørt | |
| Åbning | Kan registrere en gyldig åbning | | Ikke kørt | |
| Lukning | Kan registrere en gyldig lukning | | Ikke kørt | |
| Flyt varer | Kan flytte tilgængeligt antal, men ikke mere end lageret | | Ikke kørt | |
| QR-flytning | QR-data og flytning virker efter login | | Ikke kørt | |
| Adminside | Direkte admin-URL viser ingen adgang | | Ikke kørt | |
| Admin-API | Kald uden ejerrettighed giver 403 | | Ikke kørt | |

## Ansvarlig

| Kontrol | Forventet resultat | Faktisk resultat | Status | Fejlbeskrivelse |
| --- | --- | --- | --- | --- |
| Lagerstatus | Kan se lager med menneskelige enheder | | Ikke kørt | |
| Historik | Kan se flytninger, åbning/lukning og rettelser | | Ikke kørt | |
| Lagerrettelse | Kan udføre tilladt rettelse med auditspor | | Ikke kørt | |
| Driftsfunktioner | Ser kun funktioner tildelt Ansvarlig | | Ikke kørt | |
| Ejerindstillinger | Produkt-, lokations-, bruger- og OnlinePOS-admin afvises | | Ikke kørt | |
| Bonkontrol uden finance-gruppe | Bonkontrol-API og detaljer afvises | | Ikke kørt | |

## Økonomiansvarlig

| Kontrol | Forventet resultat | Faktisk resultat | Status | Fejlbeskrivelse |
| --- | --- | --- | --- | --- |
| Adgang | Aktivt gruppemedlem kan se bonkontroller | | Ikke kørt | |
| `open` | Sagen kan åbnes og behandles | | Ikke kørt | |
| `follow_up` | Forbliver aktiv og tæller i badge | | Ikke kørt | |
| `approved` | Forsvinder fra aktiv liste og findes i historik | | Ikke kørt | |
| `confirmed_error` | Afsluttes og findes i historik | | Ikke kørt | |
| Intern bemærkning | Gemmes og vises ved genindlæsning | | Ikke kørt | |
| Audit trail | Bruger, navn, status og tidspunkt vises | | Ikke kørt | |
| Concurrency | To faner giver forståelig 409-konflikt ved stale opdatering | | Ikke kørt | |
| Notifikation | Relevant inbox/push modtages; afsluttet sag tæller ikke ulæst | | Ikke kørt | |

## Ejer

| Kontrol | Forventet resultat | Faktisk resultat | Status | Fejlbeskrivelse |
| --- | --- | --- | --- | --- |
| Adminadgang | Alle adminfunktioner er synlige og kan åbnes | | Ikke kørt | |
| OnlinePOS-diagnostik | Ejer får svar; andre roller får 403 | | Ikke kørt | |
| Replay dry-run | Viser mappings, blokeringer og forventede lagerændringer uden skrivning | | Ikke kørt | |
| Replaybekræftelse | Kræver matching dry-run og korrekt bekræftelse | | Ikke kørt | |
| Testharness | Kræver Ejer og feature flag; testdata er isoleret | | Ikke kørt | |
| Produktadministration | Opret/redigér/deaktivér følger delete-safety | | Ikke kørt | |
| Lokationsadministration | Opret/redigér/deaktivér følger delete-safety | | Ikke kørt | |
| Roller og grupper | Kun Ejer kan ændre medlemskab og roller | | Ikke kørt | |

## Manuel push-test

1. Kontrollér at `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY` og `WEB_PUSH_SUBJECT` er konfigureret i samme miljø.
2. Log ind, åbn notifikationsindstillinger, og aktivér push på én browser/enhed.
3. Kontrollér at subscription-endpointet kun virker med brugerens token, og at subscription står aktiv.
4. Send en personlig testnotifikation. Kontrollér både OS/browser-push og permanent inbox-besked.
5. Klik pushen. Den skal åbne den interne `/notifikationer/{messageId}`-URL.
6. Afvis permission i en anden browser. Appens øvrige flows skal fortsat virke, og prompten skal kunne lukkes.
7. Deaktivér push. Subscription skal markeres inaktiv, og browserens subscription skal fjernes.
8. Test en udløbet subscription (HTTP 404/410 fra push-provider). Den skal markeres inaktiv uden at slette inbox-beskeden.
9. Udløs lageralarm som Ejer. Kun relevante gruppemedlemmer må få beskeden; Frivillig uden gruppemedlemskab må ikke.
10. Udløs bonkontrol. Økonomiansvarlige/Ejer skal følge modtagermatricen, og samme bruger må ikke få dubletter.

## Afslutning

| Kontrol | Resultat |
| --- | --- |
| Alle kritiske rækker Bestået | |
| Ingen åbne lagerpåvirkende testdata | |
| Ingen uløste adgangsfejl | |
| Godkendt af | |
