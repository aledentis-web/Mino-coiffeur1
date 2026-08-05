# Verification report — hardening booking agent condiviso

Data: 4 agosto 2026

## Risultato della milestone

Browser amministrativo e webhook WhatsApp continuano a usare lo stesso motore
conversazionale. Il fallback deterministico ora produce lo stesso modello di
turno del percorso OpenAI e passa dallo stesso merge, dalla stessa verifica di
disponibilità e dalla stessa persistenza.

Il modello distingue per servizio, data, orario e nome tre casi: campo non
menzionato, campo valido e tentativo non compreso/non valido. Un tentativo non
valido conserva il valore precedente e genera una richiesta di chiarimento.

L'abbandono della richiesta corrente è separato dalla cancellazione di un
appuntamento già esistente. Quest'ultima non è ancora implementata: l'agente lo
dichiara esplicitamente e invita a contattare direttamente il negozio, senza
modificare dati o promettere un passaggio automatico all'operatore.

## Hardening di idempotenza e concorrenza

La migration seguente è stata applicata esclusivamente al progetto Supabase di
test “Studio Barber 8”, project ref `ahzlepptjqfhlmlzdphn`:

`supabase/migrations/20260804122814_booking_agent_hardening.sql`

Supabase l'ha registrata nella cronologia remota come versione
`20260804140534`, nome `booking_agent_hardening`. Nessun altro progetto è stato
modificato.

La migration introduce:

- `booking_inbound_events`, con `provider_message_id` univoco, stati
  `processing/processed/failed`, tentativi e diagnostica di consegna;
- una lease di cinque minuti per recuperare eventi rimasti in elaborazione;
- `version` e `last_event_order_key` su `whatsapp_conversations`;
- scrittura compare-and-set con retry applicativo sui conflitti;
- rifiuto persistente dei messaggi fuori ordine;
- conferma transazionale che crea la prenotazione tramite
  `create_public_booking` e aggiorna conversazione/evento nella stessa
  transazione;
- RLS e privilegi RPC riservati a `service_role`.

Il codice mantiene comunque il rilevamento dell'assenza della RPC di claim e il
percorso legacy per ambienti nei quali la migration non sia presente.

## Gate database non-prod

Le verifiche sono state eseguite realmente sul progetto di test e hanno dato i
seguenti risultati:

- business verificato: ID `00000000-0000-4000-8000-000000000008`, nome
  “Studio Barber 8”, slug `studio-barber-8`, attivo, timezone `Europe/Rome`;
- tabella `booking_inbound_events`, colonne `version` e
  `last_event_order_key` e tutte le sei nuove funzioni presenti;
- RLS attiva sulla nuova tabella;
- funzioni `SECURITY INVOKER`;
- chiamate reali come `anon` e `authenticated` respinte con PostgreSQL `42501`;
- chiamate come `service_role` riuscite;
- transizioni `claimed`, `busy`, `failed`, retry con `attempts = 2`,
  `processed` e `duplicate` verificate;
- compare-and-set: versione errata respinta con `40001` e salvataggio con
  versione corretta avanzato da 1 a 2;
- evento fuori ordine respinto con `BOOKING_CONVERSATION_STALE_EVENT` senza
  modificare la conversazione;
- conferma transazionale riuscita: appuntamento confermato, conversazione
  `idle` versione 3 ed evento `processed` nello stesso risultato;
- conferma negativa con slot impossibile respinta con `SLOT_NOT_AVAILABLE`,
  senza appuntamento e senza avanzamento della conversazione;
- appuntamento, outbox, cliente, conversazione ed eventi sintetici eliminati;
  controllo finale: zero residui su tutte le superfici;
- Security Advisor senza errori; unico rilievo informativo:
  `rls_enabled_no_policy`, intenzionale per una tabella service-role-only senza
  grant a `anon` o `authenticated`.

## Test automatici aggiunti

La suite copre ora:

- frase unica con servizio, data, orario e nome;
- correzioni non valide di servizio, data, orario e nome su contesto completo;
- rifiuto e correzione dopo il riepilogo;
- conversazione scaduta;
- giornata piena e ricerca dei giorni alternativi;
- webhook duplicato e idempotenza della prenotazione;
- retry di un messaggio vecchio dopo uno più recente;
- messaggio mai visto ma fuori ordine;
- due messaggi concorrenti con conflitto CAS e retry senza perdita di contesto;
- sequenza OpenAI → fallback deterministico → OpenAI;
- slot occupato tra riepilogo e conferma;
- errore della RPC di creazione e stato evento `failed`;
- distinzione tra abbandono del flusso e cancellazione di un appuntamento;
- contratto SQL del registro eventi, della versione e dei privilegi.

Una GitHub Action in `.github/workflows/ci.yml` esegue su pull request e push
del branch dello sprint, senza credenziali di produzione:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

Le stesse verifiche sono state eseguite localmente dopo un `npm ci`: typecheck
superato, 60 test su 60 superati, build Next.js 16.2.12 superata, zero
vulnerabilità runtime di livello high o superiore e `git diff --check` pulito.
La scansione del diff e dei nuovi file non ha rilevato pattern di credenziali;
`.env.local` resta ignorato da Git.

## Rischi corretti

- Le correzioni non valide non azzerano più valori validi.
- L'agente non dichiara più cancellato un appuntamento esistente.
- `last_message_sid` non è più l'unico meccanismo di deduplicazione.
- Retry vecchi, duplicati e messaggi fuori ordine non riscrivono il contesto.
- Gli aggiornamenti concorrenti non usano più una strategia last-write-wins.
- La creazione e la chiusura della conversazione sono atomiche nel percorso
  hardening.
- Le diagnostiche di consegna sono associate all'evento inbound, non soltanto
  all'ultimo messaggio della conversazione.

## Test manuali ancora necessari

- Inviare dalla Preview due webhook WhatsApp reali concorrenti, un duplicato e
  un messaggio consegnato fuori ordine, verificando anche la risposta Meta.
- Verificare su Preview un messaggio WhatsApp reale, la risposta Meta e le
  colonne di diagnostica dell'evento.
- Ripetere nel browser Preview registrazione microfono, trascrizione e tre
  turni alternando percorso OpenAI e fallback.
- Concordare un eventuale canale futuro di handoff all'operatore; in questa
  milestone il testo invita a contattare il negozio e non apre un ticket.

## Fuori dalla milestone

- OpenAI Realtime, SIP e telefonate reali;
- cancellazione o modifica reale di appuntamenti esistenti;
- worker automatico di replay degli eventi `failed`;
- ordinamento più preciso del secondo quando Meta consegna due eventi con lo
  stesso timestamp: in quel caso l'ID provider fornisce un ordine stabile, non
  necessariamente l'ordine di digitazione;
- merge e deploy in produzione.
