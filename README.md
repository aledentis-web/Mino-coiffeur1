# Studio Barber 8

Business test per il segretario digitale di un barbiere: sito pubblico, agenda gestionale e un unico motore di prenotazione per sito, WhatsApp, chiamate e inserimento manuale.

## Superfici

- `/` — sito pubblico e prenotazione
- `/admin` — agenda operativa
- `/admin/voice` — simulatore chiamata con microfono del browser
- `/lab` — simulazione con 100 clienti sintetici
- `/api/public/availability` — disponibilità centralizzata
- `/api/public/bookings` — creazione atomica della prenotazione
- `/api/webhooks/twilio/whatsapp` — webhook WhatsApp firmato
- `/api/webhooks/twilio/voice` — webhook chiamate con voce e tastiera
- `/api/webhooks/meta/whatsapp` — webhook WhatsApp Cloud API
- `/api/automations/outbox/claim` — claim sicuro degli eventi per n8n
- `/api/automations/outbox/complete` — conferma o retry degli eventi n8n

## Architettura di test

- **Messaggi:** numero WhatsApp Twilio → webhook firmato → assistente
- **Voce:** numero Voice Twilio → TwiML firmato → assistente
- **Agenda:** Studio Barber 8 → Supabase/Postgres
- **Assistente:** un solo motore conversazionale per WhatsApp e voce
- **Automazioni:** outbox transazionale Supabase → n8n self-hosted

Il laboratorio vocale nel browser resta disponibile per test rapidi. Le
telefonate reali usano lo stesso assistente e la stessa agenda attraverso il
webhook Twilio Voice, senza duplicare regole di prenotazione.

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

TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_WEBHOOK_URL=
TWILIO_VOICE_WEBHOOK_URL=
TWILIO_WHATSAPP_FROM=

N8N_AUTOMATION_SECRET=

# Integrazione Meta opzionale, mantenuta come canale alternativo
META_WHATSAPP_VERIFY_TOKEN=
META_WHATSAPP_APP_SECRET=
META_WHATSAPP_ACCESS_TOKEN=
META_WHATSAPP_PHONE_NUMBER_ID=
META_GRAPH_API_VERSION=
```

`SUPABASE_SECRET_KEY` deve contenere una chiave moderna `sb_secret_...`, deve esistere soltanto negli ambienti server e non deve mai essere commessa nella repository.

Durante ogni build Vercel viene eseguito un controllo server-to-server che
verifica le variabili obbligatorie e la connessione al tenant configurato.

## Collegamento Twilio WhatsApp

1. Inserisci `TWILIO_AUTH_TOKEN` in Vercel, solo lato server.
2. Configura il Sandbox o il sender WhatsApp con metodo `POST` verso
   `https://mino-coiffeur1.vercel.app/api/webhooks/twilio/whatsapp`.
3. Imposta `TWILIO_WHATSAPP_WEBHOOK_URL` allo stesso URL stabile.
4. Dopo il redeploy invia `PRENOTA` al numero WhatsApp Twilio.

La firma `X-Twilio-Signature` viene verificata prima di elaborare ogni
messaggio; l'Auth Token resta esclusivamente sul server. Il webhook Meta resta
disponibile come integrazione alternativa.

## Collegamento Twilio Voice

1. Acquista o assegna un numero Twilio con capacità Voice.
2. Nella configurazione del numero, sotto `A call comes in`, seleziona
   `Webhook`, metodo `POST`, e inserisci
   `https://mino-coiffeur1.vercel.app/api/webhooks/twilio/voice`.
3. Imposta `TWILIO_VOICE_WEBHOOK_URL` allo stesso URL stabile e ridistribuisci.
4. Chiama il numero: l'assistente accetta voce italiana o tasti numerici,
   legge gli orari disponibili e salva l'appuntamento con canale `voice`.

## Automazioni n8n

La migration `automation_outbox` crea eventi persistenti per:

- nuova prenotazione;
- cancellazione;
- promemoria disponibile 24 ore prima.

n8n deve usare un `N8N_AUTOMATION_SECRET` casuale di almeno 32 caratteri come
Bearer token. Il worker chiama `POST /api/automations/outbox/claim`, invia il
messaggio con le credenziali Twilio conservate in n8n e infine chiama
`POST /api/automations/outbox/complete`. Gli eventi falliti vengono riprovati
con backoff e i claim scaduti tornano disponibili.

## Verifica

```bash
npm install
npm run typecheck
npm test
npm run build
```
