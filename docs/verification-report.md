# Verification report — OpenAI e voce browser

Data: 29 luglio 2026

## Storia verificata

Il cliente usa il laboratorio vocale protetto o WhatsApp Meta, il messaggio
raggiunge lo stesso motore conversazionale, un eventuale intento OpenAI viene
validato contro servizi e slot reali e la prenotazione viene scritta
atomicamente nell'agenda Supabase.

## Confini del flusso

| Confine | Stato | Evidenza |
| --- | --- | --- |
| UI pubblica | Superato | `/` risponde `200` e contiene il brand Studio Barber |
| Laboratorio vocale | Superato | `/lab` risponde `200` e presenta il test microfono browser |
| Login agenda | Superato | `/admin/login` risponde `200` |
| Route stato admin | Superato | senza sessione risponde `401` |
| Motore conversazionale | Superato | parser deterministico e fallback OpenAI con output strutturato |
| Dati autorevoli | Superato | servizi, date e slot generati dal modello sono convalidati localmente |
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
- 31 test superati;
- build Next.js 16.2.12 superata;
- nessun riferimento al provider precedente residuo;
- nessuna credenziale rilevata nei file versionati;
- nessuna vulnerabilità npm rilevata.

## Verifiche live da completare

- La chiamata OpenAI reale richiede `OPENAI_API_KEY` nell'ambiente server.
  Senza chiave il fallback deterministico è stato verificato e resta operativo.
- Il test WhatsApp reale richiede il completamento dell'onboarding Meta.
- La telefonata reale richiede una decisione separata sul provider SIP
  italiano.
- Il runner dello sprint non ha potuto scaricare Chromium dal CDN per un errore
  di certificato del proxy. Le route sono state verificate in modalità
  production-like; lo screenshot e il test microfono interattivo vanno
  ripetuti nel browser sulla preview della pull request.
