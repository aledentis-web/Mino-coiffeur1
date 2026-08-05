# Studio Barber 8 — go-live operativo

Data obiettivo del pilot: **giovedì 6 agosto 2026**.

Questo documento descrive il setup reale del segretario digitale per un barbiere: sito, agenda, WhatsApp, telefonate, interruttore generale, consumi, prenotazioni e cancellazioni.

## 1. Cosa è già nel prodotto

- Agenda unica su Supabase per sito, WhatsApp, voce e inserimenti manuali.
- Prenotazione conversazionale con conferma esplicita.
- Cancellazione conversazionale con conferma esplicita.
- Protezione da doppie prenotazioni, retry e webhook duplicati.
- Interruttore generale persistente per attività.
- Interruttori separati per WhatsApp e telefono.
- Nessuna risposta automatica WhatsApp quando l'agente è in pausa.
- Stato `active`/`paused` passato a Telnyx all'inizio di ogni telefonata.
- Registro consumi append-only per OpenAI, Meta e Telnyx.
- Conteggio token OpenAI e stima del costo testuale.
- Durata e costo reale della telefonata letti da Telnyx Session Analysis.
- Pannello cliente protetto: `/admin/assistant`.
- Laboratorio conversazionale protetto: `/admin/voice`.

## 2. Cosa non va confuso con il codice

Il software può essere pronto, ma i canali reali richiedono account, identità e numeri intestati correttamente. Prima del go-live servono:

1. un numero WhatsApp Cloud API collegato all'attività;
2. un numero telefonico Telnyx assegnato all'assistente;
3. le variabili server su Vercel;
4. almeno una chiamata e una conversazione WhatsApp di prova;
5. approvazione esplicita prima del merge e della produzione.

Per il primo pilot è più sicuro usare numeri dedicati e non portare o scollegare subito i numeri storici del negozio.

## 3. Cosa portare dal barbiere

- Telefono con la SIM e accesso agli SMS del numero da collegare.
- Credenziali Meta/Facebook dell'amministratore del Business Portfolio.
- Accesso alla mail aziendale e alla relativa 2FA.
- Documento del titolare e dati dell'attività richiesti dai provider.
- Indirizzo completo del negozio.
- Carta di pagamento per Telnyx e gli eventuali servizi a consumo.
- Numero umano di fallback, se si desidera trasferire le chiamate quando l'agente è in pausa.
- Elenco definitivo di servizi, prezzi, durata e orari di apertura.
- Regole operative: anticipo minimo, giorni chiusi, pause, ferie e modalità di cancellazione.

## 4. Variabili Vercel

Tutte le chiavi sono **server-only**. Non usare mai il prefisso `NEXT_PUBLIC_` per segreti.

### Core

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
STUDIO_BARBER_BUSINESS_SLUG=studio-barber-8
STUDIO_BARBER_RESOURCE_SLUG=main
STUDIO_BARBER_ADMIN_PASSWORD=
```

### OpenAI

```dotenv
OPENAI_API_KEY=
OPENAI_ASSISTANT_MODEL=gpt-5-mini
OPENAI_TRANSCRIPTION_MODEL=gpt-transcribe
OPENAI_PROJECT_ID=
```

### WhatsApp Meta

```dotenv
META_WHATSAPP_VERIFY_TOKEN=
META_WHATSAPP_APP_SECRET=
META_WHATSAPP_ACCESS_TOKEN=
META_WHATSAPP_PHONE_NUMBER_ID=
META_GRAPH_API_VERSION=
META_SERVICE_MESSAGE_COST_MICROEUR=0
```

`META_SERVICE_MESSAGE_COST_MICROEUR` contiene il costo di una risposta di servizio in milionesimi di euro. Rimane configurabile per non incorporare nel codice una tariffa Meta destinata a cambiare.

### Telnyx

```dotenv
VOICE_TOOL_SECRET=
VOICE_PROVIDER_ASSISTANT_ID=
VOICE_PHONE_NUMBER=
VOICE_FALLBACK_NUMBER=
TELNYX_API_KEY=
TELNYX_PUBLIC_KEY=
```

`VOICE_TOOL_SECRET` deve essere casuale e lungo almeno 32 caratteri.

Generazione consigliata:

```bash
openssl rand -hex 32
```

Dopo ogni modifica alle variabili, eseguire un nuovo deploy Preview prima della produzione.

## 5. Setup WhatsApp Cloud API

1. Aprire il Business Portfolio del cliente.
2. Collegare o creare il WhatsApp Business Account corretto.
3. Collegare un numero verificabile senza interrompere il numero storico durante il pilot.
4. Configurare come callback:

```text
<BASE_URL>/api/webhooks/meta/whatsapp
```

5. Usare lo stesso valore di `META_WHATSAPP_VERIFY_TOKEN` nel portale Meta e in Vercel.
6. Sottoscrivere gli eventi dei messaggi.
7. Inserire in Vercel app secret, access token, phone number ID e versione Graph.
8. Eseguire un nuovo deploy.
9. Lasciare l'agente in pausa.
10. Inviare un messaggio reale e verificare che venga ricevuto ma non riceva una risposta automatica.
11. Attivare WhatsApp e il master switch dal pannello.
12. Completare una prenotazione e una cancellazione reali di prova.

## 6. Setup Telnyx

### 6.1 Account e numero

1. Creare o completare l'account Telnyx del cliente.
2. Completare KYC, metodo di pagamento e requisiti del numero scelto.
3. Acquistare o assegnare un numero adatto al pilot.
4. Creare un AI Assistant Telnyx.
5. Assegnare il numero all'assistente.
6. Copiare in Vercel:
   - assistant ID;
   - numero telefonico;
   - API key;
   - public key Telnyx.

### 6.2 Dynamic variables webhook

Configurare il webhook di inizializzazione:

```text
<BASE_URL>/api/webhooks/telnyx/initialize
```

Il webhook è firmato e restituisce, per ogni telefonata:

- `agent_mode`: `active` oppure `paused`;
- `agent_enabled`;
- `agent_greeting`;
- `caller_number`;
- `fallback_number`;
- `business_name`;
- `business_timezone`.

Se Supabase non è disponibile, il sistema risponde in modalità `paused` per sicurezza.

### 6.3 Webhook di fine chiamata e costi

Configurare il webhook eventi:

```text
<BASE_URL>/api/webhooks/telnyx/voice
```

Sottoscrivere almeno l'evento:

```text
call.conversation.ended
```

Il backend verifica la firma Ed25519, registra durata e modelli usati, poi interroga Session Analysis e salva il totale reale restituito da Telnyx.

### 6.4 Autorizzazione degli strumenti

Ogni webhook tool deve inviare:

```http
Authorization: Bearer <VOICE_TOOL_SECRET>
Content-Type: application/json
```

Non inserire il segreto nel prompt.

### 6.5 Strumenti dell'assistente

#### Elenco servizi

```http
POST <BASE_URL>/api/voice/tools/services
```

Body:

```json
{}
```

#### Disponibilità

```http
POST <BASE_URL>/api/voice/tools/availability
```

Body:

```json
{
  "serviceSlug": "taglio",
  "date": "2026-08-06",
  "phone": "{{caller_number}}"
}
```

#### Prenotazione

```http
POST <BASE_URL>/api/voice/tools/book
```

Body:

```json
{
  "serviceSlug": "taglio",
  "date": "2026-08-06",
  "startTime": "15:30",
  "customerName": "Mario Rossi",
  "phone": "{{caller_number}}",
  "notes": "Prenotazione telefonica"
}
```

La prenotazione è idempotente: un retry identico non crea un secondo appuntamento.

#### Appuntamenti futuri del chiamante

```http
POST <BASE_URL>/api/voice/tools/appointments
```

Body:

```json
{
  "phone": "{{caller_number}}"
}
```

#### Cancellazione

```http
POST <BASE_URL>/api/voice/tools/cancel
```

Body:

```json
{
  "appointmentId": "<ID restituito dallo strumento appointments>",
  "phone": "{{caller_number}}",
  "confirmed": true,
  "reason": "Richiesta e confermata dal cliente durante la telefonata"
}
```

Il backend rifiuta la cancellazione se `confirmed` non è esattamente `true`.

### 6.6 Prompt Telnyx pronto da incollare

```text
Sei il segretario digitale di {{business_name}}. Parli in italiano naturale, con frasi brevi e una domanda alla volta.

STATO OPERATIVO
- Leggi sempre {{agent_mode}} prima di fare qualsiasi cosa.
- Se {{agent_mode}} è "paused", non chiamare nessuno strumento di agenda.
- In modalità paused pronuncia {{agent_greeting}}.
- Se {{fallback_number}} non è vuoto e il trasferimento è configurato, proponi il passaggio a una persona e trasferisci solo con il consenso del chiamante.
- Se non puoi trasferire, invita a richiamare e termina con educazione.

IDENTITÀ DEL CHIAMANTE
- Il numero rilevato è {{caller_number}}.
- Se è vuoto o non valido, chiedi un numero di telefono e ripetilo per conferma.
- Non leggere mai ad alta voce identificativi tecnici o UUID.

PRENOTAZIONE
1. Usa lo strumento servizi per conoscere nomi, slug, durata e prezzo.
2. Raccogli servizio, giorno, orario e nome.
3. Usa disponibilità prima di promettere qualsiasi orario.
4. Proponi soltanto slot restituiti dallo strumento.
5. Fai un riepilogo completo.
6. Chiama prenotazione solo dopo un sì esplicito del cliente.
7. Se lo slot è stato appena occupato, controlla di nuovo e proponi alternative.
8. Non inventare mai disponibilità, prezzi o conferme.

CANCELLAZIONE
1. Usa appuntamenti per recuperare gli appuntamenti futuri del numero.
2. Se ce n'è più di uno, fai scegliere data e ora senza leggere l'UUID.
3. Fai un riepilogo dell'appuntamento scelto.
4. Chiama cancellazione solo dopo un sì esplicito.
5. Passa confirmed=true soltanto dopo quel sì.
6. Se il cliente dice no o cambia idea, non cancellare nulla.

ALTRE RICHIESTE
- Per richieste non supportate, problemi, reclami o necessità umane, usa il fallback se disponibile.
- Non dichiarare mai che un'operazione è riuscita prima della risposta positiva dello strumento.
```

Nel portale Telnyx aggiungere anche lo strumento integrato di trasferimento chiamata se si usa `VOICE_FALLBACK_NUMBER`.

## 7. Accensione dal pannello cliente

1. Accedere a `/admin`.
2. Aprire **Controlla agente**.
3. Verificare i quattro indicatori:
   - agenda e database;
   - motore conversazionale;
   - WhatsApp;
   - numero telefonico.
4. Abilitare i canali desiderati.
5. Premere **Attiva agente**.
6. Effettuare subito uno smoke test.

Il master switch non dimentica i canali selezionati: una pausa sospende il lavoro, una riattivazione ripristina le preferenze precedenti.

## 8. Matrice di test obbligatoria

### Sicurezza e pausa

- Master spento: WhatsApp non invia risposte automatiche.
- Master spento: la chiamata riceve `agent_mode=paused`.
- Tool telefonici chiamati senza bearer: `401`.
- Tool telefonici chiamati mentre la voce è in pausa: `423`.
- Webhook Telnyx con firma alterata: `403`.
- Webhook Meta con firma alterata: `403`.

### Prenotazione WhatsApp

- Messaggio con tutti i dati in una frase.
- Messaggio con dati raccolti uno alla volta.
- Rifiuto del riepilogo e modifica dell'orario.
- Conferma esplicita.
- Slot occupato tra controllo e conferma.
- Doppio webhook con lo stesso message ID.
- Verifica immediata nell'agenda.

### Cancellazione WhatsApp

- Un solo appuntamento futuro.
- Più appuntamenti e scelta con numero.
- Più appuntamenti e scelta con data/ora.
- Risposta `no`: nessuna modifica.
- Risposta `sì`: stato `cancelled`, slot liberato.
- Replay dello stesso messaggio: nessuna seconda operazione.

### Telefonata

- Prenotazione completa.
- Numero chiamante nascosto: richiesta manuale del numero.
- Cancellazione con conferma esplicita.
- Richiesta non supportata e fallback.
- Chiusura chiamata e comparsa di durata/costo nel pannello.

### Pannello

- Master on/off persistente dopo refresh.
- Canali persistenti durante la pausa.
- Conteggio messaggi e appuntamenti.
- Token e costo OpenAI.
- Numero, durata e costo reale delle chiamate.
- Errori di consegna visibili.

## 9. Smoke test minimo prima di lasciarlo al cliente

1. Creare un appuntamento dal sito.
2. Creare un appuntamento via WhatsApp.
3. Creare un appuntamento via telefono.
4. Cancellarne uno via WhatsApp.
5. Cancellarne uno via telefono.
6. Verificare che tutti compaiano nella stessa agenda.
7. Spegnere l'agente e confermare che i canali non lavorino.
8. Riaccenderlo e confermare che riprenda.
9. Aprire consumi e verificare almeno un evento OpenAI, Meta e Telnyx.
10. Lasciare al cliente password amministratore e procedura di pausa.

## 10. Rollback immediato

In caso di comportamento anomalo:

1. premere **Metti in pausa**;
2. disattivare il singolo canale problematico;
3. mantenere sito e agenda attivi;
4. trasferire temporaneamente le telefonate al numero umano;
5. non eliminare eventi o appuntamenti: servono per audit e diagnosi;
6. correggere in Preview;
7. ripetere la matrice interessata prima del nuovo go-live.

## 11. Come replicarlo per un altro cliente

La base dati è multi-attività, ma il deployment corrente usa variabili specifiche per il singolo negozio. La replica più sicura oggi è:

1. creare una nuova riga `businesses` con slug univoco;
2. creare almeno una risorsa `main`;
3. inserire servizi, durate, prezzi e orari;
4. creare automaticamente `business_assistant_settings`;
5. creare un nuovo progetto Vercel dalla stessa repository;
6. impostare `STUDIO_BARBER_BUSINESS_SLUG` sul nuovo slug;
7. usare password admin e credenziali canale del cliente;
8. creare WABA/numero Meta del cliente;
9. creare assistant/numero Telnyx del cliente;
10. eseguire la stessa matrice di test;
11. attivare soltanto dopo lo smoke test.

Questo evita contaminazioni tra clienti e rende leggibili consumi, numeri e segreti. Il passo successivo verso un SaaS completo sarà sostituire le variabili per-deployment con onboarding, autenticazione multi-tenant e gestione centralizzata dei provider.

## 12. Come vengono calcolati i consumi

- **OpenAI testuale:** token input/output registrati dalla Responses API; costo calcolato con lo snapshot tariffario presente nel codice.
- **Meta:** una riga per risposta consegnata; costo unitario configurabile con `META_SERVICE_MESSAGE_COST_MICROEUR`.
- **Telnyx:** durata dall'evento `call.conversation.ended`; costo totale dalla Session Analysis della specifica call session.
- **Audit:** gli eventi di consumo sono append-only e isolati per business.

Il pannello mostra costi operativi del provider. Eventuali canoni commerciali, setup, supporto e margine dell'agenzia vanno aggiunti separatamente nel contratto con il cliente.
