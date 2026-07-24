# Studio Barber 8

Business test per il segretario digitale di un barbiere: sito pubblico, agenda gestionale e un unico motore di prenotazione per sito, WhatsApp, chiamate e inserimento manuale.

## Superfici

- `/` — sito pubblico e prenotazione
- `/admin` — agenda operativa
- `/admin/voice` — simulatore chiamata con microfono del browser
- `/lab` — simulazione con 100 clienti sintetici
- `/api/public/availability` — disponibilità centralizzata
- `/api/public/bookings` — creazione atomica della prenotazione
- `/api/webhooks/meta/whatsapp` — webhook WhatsApp Cloud API

## Architettura di test

- **Messaggi:** numero WhatsApp di test Meta → webhook firmato → assistente
- **Voce:** microfono del browser → endpoint amministratore → assistente
- **Agenda:** Studio Barber 8 → Supabase/Postgres
- **Assistente:** un solo motore conversazionale per WhatsApp e voce
- **Automazioni:** n8n self-hosted, collegato in una fase successiva agli eventi
  dell'agenda

Il laboratorio vocale simula la logica della telefonata, ma non riceve ancora
chiamate dalla rete telefonica. Il futuro operatore voce potrà usare lo stesso
endpoint applicativo senza duplicare agenda o regole di prenotazione.

## Backend

Il database Supabase/Postgres è multi-tenant. Ogni record è associato a un'attività e le policy Row Level Security isolano i dati. Il vincolo di esclusione PostgreSQL impedisce sovrapposizioni sulla stessa risorsa anche quando due richieste arrivano contemporaneamente.

## Variabili d'ambiente

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
STUDIO_BARBER_BUSINESS_SLUG=studio-barber-8
STUDIO_BARBER_RESOURCE_SLUG=main
STUDIO_BARBER_ADMIN_PASSWORD=

META_WHATSAPP_VERIFY_TOKEN=
META_WHATSAPP_APP_SECRET=
META_WHATSAPP_ACCESS_TOKEN=
META_WHATSAPP_PHONE_NUMBER_ID=
META_GRAPH_API_VERSION=
```

`SUPABASE_SECRET_KEY` deve contenere una chiave moderna `sb_secret_...`, deve esistere soltanto negli ambienti server e non deve mai essere commessa nella repository.

Durante ogni build Vercel viene eseguito un controllo server-to-server che verifica le variabili obbligatorie e la connessione al tenant configurato.

## Collegamento Meta WhatsApp

1. Nella configurazione WhatsApp dell'app Meta copia il token di accesso
   temporaneo, il `Phone number ID`, la versione Graph API e l'App Secret.
2. Crea una stringa casuale come verify token. Inserisci questi cinque valori
   direttamente nelle variabili Vercel, mai nella repository o in chat.
3. Configura in Meta il callback
   `https://mino-coiffeur1.vercel.app/api/webhooks/meta/whatsapp` e usa lo
   stesso verify token.
4. Sottoscrivi il campo `messages` e aggiungi il telefono personale tra i
   destinatari di test.
5. Dopo il redeploy invia `ciao` al numero WhatsApp di test Meta.

La firma `X-Hub-Signature-256` viene verificata prima di elaborare ogni
messaggio; il token di accesso resta esclusivamente sul server.

## Verifica

```bash
npm install
npm run typecheck
npm test
npm run build
```
