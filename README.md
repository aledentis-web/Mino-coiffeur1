# Studio Barber 8

Business test per il segretario digitale di un barbiere: sito pubblico,
agenda gestionale e un unico motore di prenotazione per sito, WhatsApp,
chiamate e inserimento manuale.

## Stato dello sprint

- sito e prenotazione pubblica: operativi;
- agenda centralizzata Supabase: operativa;
- inserimento manuale: operativo;
- dataset e simulazione di 100 clienti: operativi;
- WhatsApp: numero reale registrato, webhook Meta verificato e sottoscritto;
- voce: laboratorio protetto con microfono del browser pronto;
- telefonate reali: predisposizione OpenAI Realtime/SIP documentata, provider
  SIP italiano ancora da scegliere;
- automazioni: outbox Supabase e API n8n pronte.

## Superfici

- `/` — sito pubblico e prenotazione;
- `/admin` — agenda operativa e stato dei canali;
- `/admin/voice` — test protetto con microfono e sintesi vocale del browser;
- `/lab` — simulazione locale con 100 clienti sintetici;
- `/api/public/availability` — disponibilità centralizzata;
- `/api/public/bookings` — creazione atomica della prenotazione;
- `/api/webhooks/meta/whatsapp` — webhook firmato WhatsApp Cloud API;
- `/api/admin/assistant` — turno conversazionale protetto per il laboratorio
  vocale;
- `/api/admin/assistant/status` — stato configurazione, senza valori segreti;
- `/api/automations/outbox/claim` — claim sicuro degli eventi per n8n;
- `/api/automations/outbox/complete` — conferma o retry degli eventi n8n.

## Architettura

```text
Sito ─────────────────────────────────┐
WhatsApp Meta ── webhook firmato ─────┤
Microfono browser ── sessione admin ──┼─> motore prenotazioni ─> Supabase
Inserimento manuale ──────────────────┘          │
                                                 └─> outbox ─> n8n

Numero italiano Very
  └─> futuro inoltro SIP/VoIP italiano
        └─> OpenAI Realtime
              └─> stesso motore prenotazioni
```

Il database rimane la fonte autorevole. OpenAI estrae dal messaggio servizio,
data, orario, nome, correzioni e conferma, ma non crea appuntamenti e non
inventa disponibilità. Il server conserva il contesto in Supabase, convalida
ogni dato e interroga sempre la RPC di disponibilità prima del riepilogo e
della creazione. Se OpenAI non è configurato o non risponde entro il timeout,
il precedente flusso deterministico continua a funzionare.

## Sicurezza e multi-tenancy

- ogni record è associato a un'attività;
- le policy Row Level Security isolano i tenant;
- il vincolo di esclusione PostgreSQL impedisce sovrapposizioni sulla stessa
  risorsa, anche con richieste contemporanee;
- le creazioni passano da RPC atomiche;
- i webhook Meta vengono verificati con la firma dell'app;
- agenda, laboratorio vocale e stato configurazione richiedono la sessione
  amministratore;
- le chiavi Supabase, OpenAI, Meta e n8n sono solo server-side;
- le richieste OpenAI usano Structured Outputs e `store: false`;
- gli errori provider salvati per diagnostica sono ripuliti e troncati.

## Variabili d'ambiente

Partire da `.env.example`.

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=

STUDIO_BARBER_BUSINESS_SLUG=studio-barber-8
STUDIO_BARBER_RESOURCE_SLUG=main
STUDIO_BARBER_ADMIN_PASSWORD=

OPENAI_API_KEY=
OPENAI_ASSISTANT_MODEL=gpt-5-mini
OPENAI_TRANSCRIPTION_MODEL=gpt-transcribe
OPENAI_PROJECT_ID=
OPENAI_WEBHOOK_SECRET=
OPENAI_REALTIME_MODEL=gpt-realtime-mini
VOICE_SIP_FORWARDING_NUMBER=

N8N_AUTOMATION_SECRET=

META_WHATSAPP_VERIFY_TOKEN=
META_WHATSAPP_APP_SECRET=
META_WHATSAPP_ACCESS_TOKEN=
META_WHATSAPP_PHONE_NUMBER_ID=
META_GRAPH_API_VERSION=
```

`SUPABASE_SECRET_KEY` deve essere una chiave moderna `sb_secret_...`.
`OPENAI_API_KEY` e tutte le altre credenziali non devono mai avere il prefisso
`NEXT_PUBLIC_`, essere inviate al browser o essere commesse nel repository.

Durante le build Vercel viene eseguito un controllo server-to-server delle
variabili obbligatorie e del tenant Supabase configurato.

## Motore OpenAI

Il modello predefinito è `gpt-5-mini`, sostituibile con
`OPENAI_ASSISTANT_MODEL`. L'integrazione usa direttamente la Responses API:

1. OpenAI estrae in un solo turno tutti i dati esplicitamente forniti, senza
   ricopiare quelli già presenti nel contesto;
2. il server applica eventuali correzioni e conserva gli altri dati;
3. servizio, data e orario vengono convalidati contro servizi e disponibilità
   reali di Supabase;
4. il motore chiede soltanto i dati mancanti oppure propone orari alternativi;
5. quando i dati sono completi mostra un riepilogo e attende un sì esplicito;
6. dopo la conferma ricontrolla lo slot e chiama la RPC atomica
   `create_public_booking`;
7. se l'estrazione OpenAI non è disponibile, delega l'intero turno al vecchio
   assistente deterministico.

Per un test completo serve la chiave di progetto Studio Barber 8 nel solo
ambiente server. La repository non contiene né legge credenziali dal browser.

## Test vocale dal browser

1. configurare Supabase e la password amministratore;
2. avviare l'app e accedere a `/admin`;
3. aprire `/admin/voice`;
4. scegliere un cliente sintetico;
5. consentire l'accesso al microfono;
6. dire “Vorrei prenotare”, completare il flusso e verificare l'appuntamento in
   agenda.

Il browser registra al massimo 20 secondi con `MediaRecorder` e invia l'audio
alla route protetta `/api/admin/assistant/transcribe`. Il server accetta solo
formati audio esplicitamente ammessi, impone un limite di 10 MB e trascrive con
`gpt-transcribe`, senza esporre la chiave OpenAI. Il testo attraversa poi lo
stesso backend di WhatsApp e salva sullo stesso database. La sintesi della
risposta resta locale nel browser e l’input manuale è sempre disponibile.

## WhatsApp Meta

Il numero reale è registrato in WhatsApp Business Platform. Il webhook Meta è
verificato e sottoscritto; le credenziali restano nelle variabili server-side
della Preview Vercel.

Per una verifica end-to-end inviare una frase completa al numero registrato,
confermare il riepilogo e controllare la provenienza `whatsapp` nell'agenda.

Non sono necessarie modifiche al motore prenotazioni quando si passa dal
numero di test al numero definitivo.

## Telefonate reali: prossimo checkpoint

Il numero mobile Very non espone direttamente un trunk SIP. Per collegare
telefonate reali servirà un provider SIP/VoIP compatibile con numerazione o
inoltro italiano. Il flusso previsto è:

1. il cliente chiama il numero pubblico;
2. l'operatore inoltra la chiamata al trunk SIP;
3. il trunk punta al progetto OpenAI Realtime;
4. il backend riceve l'evento di chiamata, accetta la sessione e permette al
   modello di chiamare soltanto gli strumenti del motore prenotazioni;
5. la prenotazione appare in Supabase con canale `voice`.

La scelta del provider e qualunque modifica a Very/SIP restano fuori da questo
sprint e richiedono una decisione esplicita.

## Automazioni n8n

La migration `automation_outbox` crea eventi persistenti per:

- nuova prenotazione;
- cancellazione;
- promemoria disponibile 24 ore prima.

n8n self-hosted usa un `N8N_AUTOMATION_SECRET` casuale di almeno 32 caratteri
come Bearer token. Il worker chiama `POST /api/automations/outbox/claim`,
esegue l'azione tramite il provider configurato e infine chiama
`POST /api/automations/outbox/complete`. Gli eventi falliti vengono riprovati
con backoff e i claim scaduti tornano disponibili.

## Verifica locale

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Il test browser richiede inoltre l'accesso amministratore e un ambiente con le
variabili Supabase configurate. Il test live OpenAI richiede la chiave
server-side; senza chiave viene verificato il percorso di fallback.

I risultati dell'ultimo gate sono raccolti in
[`docs/verification-report.md`](docs/verification-report.md).
