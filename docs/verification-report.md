# Verification report — agente conversazionale condiviso

Data: 3 agosto 2026

## Storia verificata

Il cliente usa il laboratorio vocale protetto o WhatsApp Meta. Lo stesso agente
estrae più dati da una frase, conserva il contesto, applica correzioni, consulta
la disponibilità reale e richiede una conferma esplicita prima di scrivere
atomicamente la prenotazione nell'agenda Supabase.

## Confini del flusso

| Confine | Stato | Evidenza |
| --- | --- | --- |
| UI pubblica | Superato | `/` risponde `200` e contiene il brand Studio Barber |
| Laboratorio vocale | Superato | registrazione `MediaRecorder`, trascrizione OpenAI server-side e input manuale |
| Login agenda | Superato | `/admin/login` risponde `200` |
| Route stato admin | Superato | senza sessione risponde `401` |
| Motore conversazionale | Superato | Structured Outputs multi-campo con fallback deterministico completo |
| Contesto e correzioni | Superato | i dati persistono tra i messaggi e le modifiche non azzerano il flusso |
| Dati autorevoli | Superato | servizi, date e slot sono convalidati e riletti tramite RPC Supabase |
| Conferma | Superato | riepilogo obbligatorio e creazione soltanto dopo un sì esplicito |
| Concorrenza | Superato | simulazione di 100 clienti senza sovrapposizioni |
| Immagini Next.js | Superato | ottimizzazione Sharp `200`, output 640×334 e CSP restrittiva |
| Supabase security advisor | Superato | nessun rilievo di sicurezza |
| Dipendenze runtime | Superato | `npm audit --omit=dev` restituisce zero vulnerabilità |

## Comandi

```bash
npm ci
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

Risultato dello sprint:

- typecheck superato;
- 43 test automatici superati;
- build Next.js 16.2.12 superata;
- nessun riferimento al provider precedente residuo;
- nessuna credenziale rilevata nei file versionati;
- nessuna vulnerabilità npm rilevata.

## Verifiche live

- La chiave locale dedicata ha superato uno smoke test reale della nuova
  estrazione multi-campo sulla Responses API: servizio, data, ora e nome sono
  stati restituiti correttamente. La chiave resta in `.env.local`, ignorata da
  Git.
- Un campione MP3 locale con la frase “Vorrei prenotare un taglio domani” ha
  attraversato login amministrativo, route protetta e Audio API. La risposta
  reale è stata “Vorrei prenotare un taglio domani.”.
- Numero reale, verifica e sottoscrizione webhook Meta risultano configurati.
  In questa sessione non è stato inviato un messaggio reale al cliente.
- La telefonata reale richiede una decisione separata sul provider SIP
  italiano.
- Il runner dello sprint non ha potuto scaricare Chromium dal CDN per un errore
  di certificato del proxy. Le route sono state verificate in modalità
  production-like; lo screenshot e il test microfono interattivo vanno
  ripetuti nel browser sulla preview della pull request.
