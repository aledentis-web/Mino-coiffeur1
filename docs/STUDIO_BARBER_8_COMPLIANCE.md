# Studio Barber 8 — checklist trasparenza e privacy

Questa checklist accompagna il runbook tecnico. Non sostituisce una valutazione legale professionale, ma definisce le impostazioni minime da non saltare durante il pilot.

## 1. Dichiarare subito che è un assistente IA

Dal 2 agosto 2026 si applicano le obbligazioni di trasparenza dell'articolo 50 dell'AI Act per i sistemi interattivi. Il cliente deve capire chiaramente che non sta parlando con una persona.

Il saluto telefonico configurato nel runbook è intenzionale:

```text
Ciao, hai chiamato Studio Barber 8. Sono l'assistente digitale: posso aiutarti a prenotare o cancellare un appuntamento.
```

Il primo messaggio WhatsApp automatico deve usare una formula equivalente, per esempio:

```text
Ciao, sono l'assistente digitale di Studio Barber 8. Posso aiutarti a prenotare o cancellare un appuntamento.
```

Non rimuovere questa informazione e non presentare l'agente come una segretaria umana.

Riferimenti ufficiali:

- https://digital-strategy.ec.europa.eu/en/policies/guidelines-transparency-ai-generated-content
- https://eur-lex.europa.eu/eli/reg/2024/1689/oj

## 2. Informativa privacy prima del go-live

Aggiornare l'informativa dell'attività indicando almeno:

- titolare del trattamento e contatti;
- finalità: gestione richieste, agenda, prenotazioni, cancellazioni e assistenza;
- dati trattati: numero, nome, contenuto dei messaggi, data/ora e dettagli dell'appuntamento;
- base giuridica applicabile;
- tempi di conservazione;
- diritti dell'interessato e modalità di esercizio;
- fornitori che trattano dati per conto dell'attività;
- eventuali trasferimenti extra SEE e relative garanzie;
- presenza dell'assistente IA e possibilità di richiedere una persona.

Inserire il link all'informativa:

- nel sito;
- nel profilo WhatsApp Business;
- nel messaggio iniziale o in una risposta breve richiamabile con la parola `privacy`.

## 3. Ruoli e accordi con i fornitori

Prima della produzione verificare i termini e gli accordi sul trattamento dati disponibili per:

- Meta / WhatsApp Business Platform;
- Telnyx;
- OpenAI;
- Supabase;
- Vercel.

Il barbiere è normalmente il titolare dei dati dei propri clienti. L'agenzia deve definire contrattualmente il proprio ruolo e le istruzioni ricevute. Non usare credenziali personali condivise in modo informale come asset permanente del cliente.

## 4. Minimizzazione dei dati

Il prodotto deve chiedere soltanto ciò che serve per l'appuntamento:

- nome;
- numero di telefono;
- servizio;
- data e ora;
- eventuale nota strettamente necessaria.

Non chiedere documenti, dati sanitari, dati di pagamento o altre informazioni non necessarie.

Il ledger dei consumi salva soltanto metadati operativi. Per le chiamate conserva le ultime quattro cifre del chiamante nel registro tecnico, non il numero completo.

## 5. Registrazioni e trascrizioni

Per il pilot:

- non abilitare la registrazione audio;
- non conservare l'audio della chiamata;
- limitare o disattivare la conservazione delle trascrizioni nel provider quando non necessaria;
- non usare conversazioni reali per addestramento o analisi ulteriori senza una base e un'informazione adeguate;
- se in futuro si registra, fare una valutazione separata e informare chiaramente il chiamante prima dell'avvio.

Il nostro backend registra durata, esito, costo e operazioni di agenda, ma non richiede la registrazione dell'audio.

## 6. Conservazione proposta per il pilot

Da confermare con il titolare:

- appuntamenti: per il periodo necessario alla gestione e agli obblighi amministrativi applicabili;
- conversazioni operative: cancellazione o anonimizzazione dopo un periodo breve definito;
- eventi tecnici e di consegna: conservazione limitata per sicurezza, contestazioni e diagnosi;
- eventi di consumo: conservazione coerente con rendicontazione e fatturazione;
- registrazioni audio: disattivate.

La durata non deve restare indefinita. Va documentata nell'informativa e applicata con una procedura di cancellazione periodica.

## 7. Accesso e sicurezza

- password amministratore unica per il cliente;
- 2FA sugli account Meta, Telnyx, OpenAI, Vercel e Supabase;
- segreti soltanto nelle variabili server di Vercel;
- nessuna chiave inviata in chat o inserita nel prompt Telnyx;
- revoca immediata degli accessi quando cambia il gestore;
- backup e log adeguati al livello di produzione;
- master switch in pausa durante configurazione e incidenti.

## 8. Intervento umano

Configurare un numero umano di fallback e spiegare all'agente quando proporlo. Il cliente deve poter chiedere una persona per:

- reclami;
- errori o conflitti sull'agenda;
- richieste non supportate;
- esercizio dei diritti privacy;
- situazioni che richiedono una decisione del titolare.

L'agente non deve inventare una soluzione quando uno strumento fallisce.

## 9. Controllo da fare con il barbiere

Prima dell'attivazione il titolare deve vedere e approvare:

1. la frase con cui l'agente si presenta;
2. i dati richiesti ai clienti;
3. l'informativa privacy;
4. i fornitori usati;
5. i tempi di conservazione;
6. il comportamento in pausa;
7. il numero umano di fallback;
8. la procedura per esportare, correggere o cancellare i dati di un cliente.

## 10. Regola di go-live

L'agente resta in pausa finché non sono contemporaneamente vere queste condizioni:

- saluto IA approvato;
- informativa pubblicata;
- credenziali intestate e protette;
- registrazione audio disattivata;
- fallback umano verificato;
- prenotazione e cancellazione reali testate;
- master switch provato in entrambe le direzioni.
