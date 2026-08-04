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
dichiara esplicitamente e indirizza all'operatore senza modificare dati.

## Hardening di idempotenza e concorrenza

È stata creata, ma **non applicata a nessun ambiente remoto**, la migration:

`supabase/migrations/20260804122814_booking_agent_hardening.sql`

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

Finché la migration non viene applicata, il codice rileva l'assenza della RPC
di claim e usa il percorso legacy. Questo evita di interrompere le Preview già
attive, ma le nuove garanzie di concorrenza diventano effettive solo dopo una
futura applicazione controllata della migration.

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

- Applicare la migration prima in un ambiente Supabase non produttivo e
  verificare le RPC con due webhook reali concorrenti.
- Verificare su Preview un messaggio WhatsApp reale, la risposta Meta e le
  colonne di diagnostica dell'evento.
- Ripetere nel browser Preview registrazione microfono, trascrizione e tre
  turni alternando percorso OpenAI e fallback.
- Verificare il passaggio all'operatore concordando il canale operativo reale;
  in questa milestone il testo informa il cliente ma non apre un ticket.

## Fuori dalla milestone

- OpenAI Realtime, SIP e telefonate reali;
- cancellazione o modifica reale di appuntamenti esistenti;
- worker automatico di replay degli eventi `failed`;
- ordinamento più preciso del secondo quando Meta consegna due eventi con lo
  stesso timestamp: in quel caso l'ID provider fornisce un ordine stabile, non
  necessariamente l'ordine di digitazione;
- merge e deploy in produzione.
