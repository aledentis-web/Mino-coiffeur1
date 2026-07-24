# Studio Barber 8

Business test per il segretario digitale di un barbiere: sito pubblico, agenda gestionale e un unico motore di prenotazione per sito, WhatsApp, chiamate e inserimento manuale.

## Superfici

- `/` — sito pubblico e prenotazione
- `/admin` — agenda operativa
- `/lab` — simulazione con 100 clienti sintetici
- `/api/public/availability` — disponibilità centralizzata
- `/api/public/bookings` — creazione atomica della prenotazione

## Backend

Il database Supabase/Postgres è multi-tenant. Ogni record è associato a un'attività e le policy Row Level Security isolano i dati. Il vincolo di esclusione PostgreSQL impedisce sovrapposizioni sulla stessa risorsa anche quando due richieste arrivano contemporaneamente.

## Variabili d'ambiente

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
STUDIO_BARBER_BUSINESS_SLUG=studio-barber-8
STUDIO_BARBER_RESOURCE_SLUG=main
```

`SUPABASE_SECRET_KEY` deve contenere una chiave moderna `sb_secret_...`, deve esistere soltanto negli ambienti server e non deve mai essere commessa nella repository.

Durante ogni build Vercel viene eseguito un controllo server-to-server che verifica le variabili obbligatorie e la connessione al tenant configurato.

## Verifica

```bash
npm install
npm run typecheck
npm test
npm run build
```
