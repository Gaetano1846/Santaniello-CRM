# Santaniello CRM — Node.js 22 + PostgreSQL

Riscrittura della app FlutterFlow **SantanielloCRM / LegalFlow** (gestionale per studio legale).
Legge e scrive **lo stesso progetto Firebase** con gli stessi nomi di collezioni e campi e gli stessi formati,
per cui le due app possono funzionare in parallelo sugli stessi dati.

| | Originale | Nuovo |
|---|---|---|
| Frontend | Flutter Web (FlutterFlow) | React 19 + Vite 6, design system proprio (chiaro/scuro, responsive) |
| Backend | Nessuno: il client scrive direttamente su Firestore | Node.js 22 + Express 5 + firebase-admin |
| Auth | Firebase Auth dal client | Firebase Auth (REST) → cookie di sessione httpOnly firmato |
| Dati | Firestore / Storage | Gli stessi (oppure la modalità demo locale) |
| Ricerca | Algolia, con la chiave inserita nel codice del client | Algolia chiamato dal server (chiave in `.env`), con ricerca locale di riserva |

## Database PostgreSQL

Il progetto usa PostgreSQL come database principale (`server/db/postgres/`):

- **Schema relazionale** in `schema.sql`: una tabella per collezione, chiavi esterne tra clienti,
  consulenze, casi, cartelle, file, attività, promemoria e appuntamenti; indici per tutte le query dell'app.
  Viene applicato automaticamente a ogni avvio; il database viene creato se non esiste.
- **Integrità gestita dal database**:
  - eliminare un cliente elimina i suoi contatti; eliminare un caso elimina i contatti del caso;
  - eliminare una cartella elimina sottocartelle e record dei file (i file fisici li rimuove l'app);
  - consulenze, casi, attività e cartelle collegate a un cliente eliminato restano, senza collegamento (`SET NULL`);
  - non si può salvare un riferimento a un record inesistente.
- **Accesso**: in modalità PostgreSQL login e registrazione sono gestiti dall'app
  (password con hash scrypt nella tabella `auth_accounts`), senza Firebase.
- **File**: i documenti caricati vengono salvati in `data/uploads` (`UPLOADS_DIR`).

### Configurazione
```
DATABASE_URL=postgres://UTENTE:PASSWORD@localhost:5432/santaniello_crm
```
nel file `.env`, poi:
```bash
npm run db:migrate      # crea database e tabelle (facoltativo: avviene anche all'avvio)
npm run seed            # dati di esempio (solo se il database è vuoto; --force per ricrearli)
npm run db:import -- --from=firestore   # oppure: importa i dati reali dall'app Firebase originale
npm run db:import -- --from=memory      # oppure: importa la demo data/db.json
```
L'import è ripetibile (aggiorna per id), azzera i riferimenti orfani lasciati dall'app originale e
salta i contatti/file senza contenitore. Le password di Firebase Auth non sono esportabili: ogni
avvocato si "registra" di nuovo con la stessa email e l'account viene collegato al suo profilo importato.
I file importati da Firebase restano scaricabili dai loro URL originali.

## Avvio

```bash
npm install
npm run seed      # solo demo: crea data/db.json con dati di esempio
npm run build     # compila il frontend in dist/
npm start         # http://localhost:4310
```

Sviluppo con hot reload: `npm run dev` (API su :4310, Vite su :5173).
Test: `npm test` (esegue la stessa suite sia sulla demo JSON sia su un vero motore PostgreSQL in-process).

**Accesso demo** (solo modalità `memory`): `g.santaniello@studio.it` / `santaniello`.

### Collegamento al Firebase reale
1. Copia `.env.example` in `.env`.
2. Imposta `DATA_DRIVER=firestore`, un service account (`GOOGLE_APPLICATION_CREDENTIALS`) e `FIREBASE_WEB_API_KEY`.
3. Per la ricerca globale imposta anche `ALGOLIA_APP_ID` e `ALGOLIA_SEARCH_KEY`.

Gli indici Firestore già definiti in `firebase/firestore.indexes.json` sono sufficienti.
Le query con più filtri vengono ordinate lato client apposta, per non richiedere indici nuovi.

## Struttura

```
server/
  index.js              Express: API, file statici, gestione errori
  config.js             variabili d'ambiente
  db/schema.js          schema Firestore (nomi campi identici all'originale)
  db/firestore.js       adapter firebase-admin (DocumentReference ↔ "Collezione/id", Timestamp ↔ Date)
  db/postgres/          adapter PostgreSQL (schema.sql + traduzione query → SQL)
  db/import.js          importazione Firestore/demo → PostgreSQL
  db/memory.js          adapter demo con la semantica di Firestore (where/orderBy/limit/in/array-contains)
  db/seed.js            dati di esempio
  domain/folders.js     porting delle custom action per cartelle ed eliminazioni
  domain/appuntamenti.js  calcolaAppuntamentiRecenti
  services/             auth, storage (upload/eliminazione), ricerca (Algolia)
  routes/               /api/auth, /api/data|doc (CRUD validato sullo schema), /api/folders, /api/files, /api/search
client/src/
  pages/                Calendario, Clienti, Cliente, Consulenze, Consulenza, Casi, Caso, Documenti, LogAttivita, Login
  components/           FileExplorer, Calendar, ActivityFeed, Contacts, forms (tutti i dialog), pickers, ui
  lib/activity.js       titoli del registro attività
test/domain.test.js     test della logica portata
```

## Corrispondenza con l'app originale

| Originale (Dart) | Nuovo |
|---|---|
| `newCustomAction` | `domain/folders.js › createEntityFolder` (Explorer → Clienti → cliente → consulenza/caso) |
| `newCustomAction2` | `findExplorer` |
| `creaSottocartella` | `createSubfolder` (`Array_Parents = [padre, …antenati]`) |
| `deleteFolderAndFilesWithSubfolders` | `deleteFolderRecursive` (sottocartelle, file, `VersioneFile`, oggetti Storage su entrambi i bucket) |
| `deleteSingleFileFinalCorrect` | `deleteSingleFile` |
| `algoliaSearchClienti/Consulenze` | `services/search.js` (Algolia + recupero a blocchi di 10 id) |
| `calcolaAppuntamentiRecenti` | `domain/appuntamenti.js` (ora usata nella card "Appuntamenti più vicini") |
| `calcolaDataRecente` | la finestra "ultimi 2 giorni" delle attività e dei documenti recenti |
| `SimpleDropZone` | trascinamento dei file + pulsante "Carica file" (`files/<ms>_<nome>`, documento `Files`) |
| `NewCustomWidget` / `MobileCalendarWidget` | `components/Calendar.jsx`: mese, settimana e giorno; nella vista giorno si sposta un evento trascinandolo |

I formati salvati restano invariati:
- le date di appuntamenti, promemoria, casi e consulenze sono stringhe `dd/MM/yyyy` e `HH:mm`;
- `Clienti.Telefono` è un intero;
- il campo `Avvovati_Supporto` dei Casi mantiene il refuso del nome originale.

## Differenze rispetto all'originale

Questi sono bug dell'app originale, corretti nella riscrittura:

**Accesso e navigazione**
- Tutte le rotte richiedono il login (nell'originale nessuna era protetta) ed è stato aggiunto "Esci".
- La pagina Caso ora è raggiungibile: prima nessun link portava lì e la voce di menu "Casi" era sempre nascosta.
- Nella pagina Caso la scheda Contatti funziona e l'apertura avviene su Panoramica.
- Le pagine di dettaglio si aggiornano dopo una modifica. Dopo un'eliminazione si torna all'elenco.
- La ricerca globale usa un solo popup, che si chiude alla navigazione; l'ordine di rilevanza di Algolia viene mantenuto.

**Dialog di creazione e modifica**
- Crea caso ora salva l'area pratica selezionata (prima scriveva sempre `''`).
- Modifica caso e Modifica consulenza sono precompilati e non azzerano più:
  - `Descrizione`, `Data_Inizio` e `Scadenza`;
  - gli avvocati di supporto;
  - `Data_Creazione`.
- Gli appuntamenti salvano `Consulenza_Ref`. Senza questo campo non comparivano nel calendario della consulenza.
- Nella scheda cliente il campo "Note" mostra `Note` e non l'indirizzo; il campo è anche modificabile.
- I selettori di cliente, avvocato e consulenza lavorano per id, non per nome visualizzato: prima, con nomi duplicati, veniva scelto il documento sbagliato.
- Promemoria e appuntamenti della pagina Consulenza sono filtrati per consulenza.
- ModificaFolder ora cambia davvero la consulenza collegata.

**Esplora documenti**
- Il breadcrumb è nell'ordine giusto e non risale oltre la cartella radice dell'entità.
- "Indietro" porta sempre alla cartella padre.
- Si possono aprire sottocartelle a qualsiasi livello.
- I file vengono caricati nella cartella aperta (nella pagina Documenti finivano nella cartella padre).
- Nel Caso le eliminazioni usano le routine ricorsive: prima restavano file orfani nello Storage.
- Se manca la cartella radice viene offerto il pulsante "Crea cartella" (l'originale andava in crash).

**Registro attività**
- La creazione di un appuntamento dal calendario registra un titolo (prima era vuoto).
- Il Log ha filtri per consulenza e per data e mostra i risultati a pagine.
- Nei titoli del registro sono corretti i refusi evidenti ("conselenza", "Cartellla", spazio mancante).

I testi dell'interfaccia sono in italiano corretto; sono stati eliminati refusi come "Serch", "Aggingi" e "documnto".

Le operazioni sui dati **non** cambiano. Ad esempio, eliminare un cliente, un caso o una consulenza cancella solo il documento principale, come nell'originale.

## Sicurezza — da sapere

Nell'app originale:
- le regole Firestore sono completamente aperte (`allow read, write: if true`);
- le chiavi Algolia sono scritte nel codice del client.

Questa riscrittura accede ai dati solo dal server, dopo il login. Le regole però vanno comunque ristrette in Firebase: finché restano aperte, chiunque abbia la configurazione web può leggere e scrivere il database.

Restringerle bloccherebbe l'app Flutter, che usa l'SDK client. Conviene quindi farlo quando la nuova app la sostituisce del tutto.
