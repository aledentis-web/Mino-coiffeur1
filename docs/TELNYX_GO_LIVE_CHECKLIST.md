# Studio Barber 8 — checklist Telnyx go-live

Aggiornata il **12 agosto 2026** dopo l'approvazione dell'account Telnyx.

Questa checklist completa il runbook generale `STUDIO_BARBER_8_GO_LIVE.md` e descrive l'ordine esatto da seguire per collegare il numero reale senza modificare prematuramente la produzione.

## Stato iniziale

- Branch di rilascio: `agent/studio-barber-8-openai-voice`.
- Pull request: `#2`, da mantenere Draft fino al completamento dei test reali.
- Agenda, sito, pannello, WhatsApp e strumenti vocali condividono lo stesso database Supabase.
- Il master switch e il canale voce devono restare in pausa durante la prima configurazione.
- Segreti e chiavi non devono mai essere inseriti nel repository, nel prompt dell'assistente o in variabili `NEXT_PUBLIC_*`.

## 1. Preparare Vercel Preview

Configurare nell'ambiente **Preview** del progetto:

```dotenv
VOICE_TOOL_SECRET=<valore casuale di almeno 32 caratteri>
VOICE_PROVIDER_ASSISTANT_ID=<id dell'AI Assistant Telnyx>
VOICE_PHONE_NUMBER=<numero Telnyx in formato E.164>
VOICE_FALLBACK_NUMBER=<numero umano opzionale in formato E.164>
TELNYX_API_KEY=<api key server-side>
TELNYX_PUBLIC_KEY=<public key Ed25519 dei webhook>
```

Generare `VOICE_TOOL_SECRET` localmente con:

```bash
openssl rand -hex 32
```

Dopo l'inserimento delle variabili, creare un nuovo deploy Preview e verificare che il build sia verde.

## 2. Creare o aggiornare l'AI Assistant Telnyx

Nel portale Telnyx:

1. creare un AI Assistant dedicato a Studio Barber 8;
2. impostare lingua e voce italiane;
3. incollare il prompt presente nel runbook generale;
4. annotare l'Assistant ID e inserirlo in `VOICE_PROVIDER_ASSISTANT_ID`;
5. lasciare inizialmente il numero non esposto ai clienti e l'agente in pausa dal pannello Studio Barber 8.

## 3. Configurare le variabili dinamiche

Impostare come Dynamic Variables Webhook:

```text
<PREVIEW_BASE_URL>/api/webhooks/telnyx/initialize
```

Impostare esplicitamente:

```text
dynamic_variables_webhook_timeout_ms = 10000
```

Il valore è importante perché il webhook legge lo stato dell'agente da Supabase prima di rispondere. Il timeout predefinito del provider può essere troppo breve durante un cold start.

Configurare inoltre valori di fallback sicuri nell'assistente:

```json
{
  "agent_mode": "paused",
  "agent_enabled": "false",
  "agent_greeting": "Ciao, hai chiamato Studio Barber 8. Il servizio automatico è momentaneamente in pausa.",
  "caller_number": "",
  "fallback_number": "",
  "business_name": "Studio Barber 8",
  "business_timezone": "Europe/Rome"
}
```

Se il webhook non risponde, l'assistente deve quindi comportarsi come **in pausa** e non deve chiamare strumenti di agenda.

## 4. Creare i cinque strumenti condivisi

Usare la Tools Library di Telnyx e creare cinque webhook tool. Collegare gli stessi strumenti all'AI Assistant.

Ogni richiesta deve avere:

```http
Authorization: Bearer <VOICE_TOOL_SECRET>
Content-Type: application/json
```

Conservare il valore del bearer come Integration Secret nel provider; non scriverlo nel prompt.

### Servizi

```http
POST <PREVIEW_BASE_URL>/api/voice/tools/services
```

```json
{}
```

### Disponibilità

```http
POST <PREVIEW_BASE_URL>/api/voice/tools/availability
```

```json
{
  "serviceSlug": "taglio",
  "date": "2026-08-13",
  "phone": "{{caller_number}}"
}
```

### Prenotazione

```http
POST <PREVIEW_BASE_URL>/api/voice/tools/book
```

```json
{
  "serviceSlug": "taglio",
  "date": "2026-08-13",
  "startTime": "15:30",
  "customerName": "Mario Rossi",
  "phone": "{{caller_number}}",
  "notes": "Prenotazione telefonica"
}
```

### Appuntamenti futuri

```http
POST <PREVIEW_BASE_URL>/api/voice/tools/appointments
```

```json
{
  "phone": "{{caller_number}}"
}
```

### Cancellazione

```http
POST <PREVIEW_BASE_URL>/api/voice/tools/cancel
```

```json
{
  "appointmentId": "<ID restituito dallo strumento appointments>",
  "phone": "{{caller_number}}",
  "confirmed": true,
  "reason": "Richiesta e confermata dal cliente durante la telefonata"
}
```

La cancellazione deve essere chiamata soltanto dopo una conferma esplicita del cliente.

## 5. Configurare il webhook degli eventi

Impostare il webhook eventi dell'assistente su:

```text
<PREVIEW_BASE_URL>/api/webhooks/telnyx/voice
```

Sottoscrivere almeno:

```text
call.conversation.ended
```

Questo evento permette al backend di registrare durata, modelli usati e costo effettivo della call session. Le richieste vengono accettate soltanto con firma Telnyx Ed25519 valida.

## 6. Assegnare il numero approvato

1. verificare che il numero sia attivo e abilitato alla voce;
2. assegnarlo all'AI Assistant corretto;
3. verificare che il numero coincida con `VOICE_PHONE_NUMBER` in Vercel;
4. controllare che Assistant ID, API key e public key appartengano allo stesso account Telnyx;
5. mantenere ancora il master switch in pausa.

## 7. Primo test in modalità pausa

Chiamare il numero reale con il master switch spento.

Risultato obbligatorio:

- il webhook di inizializzazione viene accettato;
- `agent_mode` vale `paused`;
- l'assistente pronuncia il messaggio di pausa;
- nessuno strumento di agenda viene chiamato;
- nel pannello compare un evento di inizializzazione chiamata.

Un risultato diverso blocca il go-live.

## 8. Test attivo end-to-end

Dal pannello `/admin/assistant`:

1. abilitare il canale telefono;
2. attivare il master switch;
3. chiamare da un numero reale visibile;
4. chiedere i servizi disponibili;
5. prenotare uno slot realmente disponibile;
6. verificare subito l'appuntamento nell'agenda;
7. richiamare dallo stesso numero;
8. chiedere gli appuntamenti futuri;
9. cancellare l'appuntamento confermando esplicitamente;
10. verificare stato `cancelled` e slot nuovamente libero;
11. chiudere la chiamata e controllare durata e costo nel pannello consumi.

Ripetere almeno una volta con numero chiamante nascosto: l'assistente deve chiedere un numero manuale e ripeterlo per conferma.

## 9. Test negativi obbligatori

- Tool senza bearer: risposta `401`.
- Tool con voce in pausa: risposta `423`.
- Firma webhook alterata: risposta `403`.
- Prenotazione senza conferma esplicita: nessuna scrittura.
- Cancellazione con `confirmed=false`: nessuna modifica.
- Replay della stessa richiesta: nessun doppio appuntamento o doppia cancellazione.
- Slot occupato tra controllo e conferma: proposta di alternative, mai conferma inventata.

## 10. Criteri per il merge in produzione

La PR `#2` può uscire da Draft e venire unita in `main` soltanto quando:

- CI e build Vercel sono verdi;
- chiamata in pausa superata;
- prenotazione telefonica reale superata;
- cancellazione telefonica reale superata;
- durata e costo Telnyx visibili;
- prenotazione e cancellazione WhatsApp rieseguite senza regressioni;
- sito, WhatsApp, telefono e inserimento manuale convergono sulla stessa agenda;
- il master switch interrompe e riattiva davvero entrambi i canali;
- non risultano errori critici nei log Preview.

Dopo il merge, ripetere uno smoke test minimo sul dominio di produzione prima di consegnare il sistema al cliente.

## Rollback

Alla prima anomalia:

1. premere **Metti in pausa**;
2. disabilitare il canale telefono;
3. mantenere sito e agenda disponibili;
4. inoltrare temporaneamente le chiamate a un numero umano, se configurato;
5. conservare log ed eventi per la diagnosi;
6. correggere e ripetere la matrice in Preview prima della riattivazione.
