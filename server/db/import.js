/**
 * Importa tutti i dati in PostgreSQL (DATABASE_URL) da un'altra sorgente:
 *   npm run db:import -- --from=firestore      (progetto Firebase dell'app originale; richiede le credenziali in .env)
 *   npm run db:import -- --from=memory         (database demo data/db.json)
 *
 * I riferimenti a documenti inesistenti (orfani lasciati dall'app originale) vengono
 * azzerati; contatti e file il cui contenitore non esiste più vengono saltati.
 * È idempotente: reimportare aggiorna i record esistenti (upsert per id).
 */
import { config } from '../config.js';
import { createPostgresAdapter, TABLES } from './postgres/index.js';

const from = (process.argv.find((a) => a.startsWith('--from=')) ?? '--from=memory').split('=')[1];
if (!config.databaseUrl) {
  console.error('Imposta DATABASE_URL nel file .env');
  process.exit(1);
}

let source;
if (from === 'firestore') {
  const { createFirestoreAdapter } = await import('./firestore.js');
  source = createFirestoreAdapter();
} else if (from === 'memory') {
  const { createMemoryAdapter } = await import('./memory.js');
  source = createMemoryAdapter();
} else {
  console.error(`Sorgente sconosciuta: ${from} (usa firestore o memory)`);
  process.exit(1);
}
const target = await createPostgresAdapter(config.databaseUrl);

// 1. lettura completa della sorgente
const TOP = ['Users', 'Clienti', 'Consulenze', 'Casi', 'Folder', 'Files', 'Activity', 'Promemoria', 'Appuntamenti'];
const data = {};
for (const col of TOP) data[col] = await source.query(col);
data.Contatti = await source.collectionGroup('Contatti');
data.Contatti_Caso = await source.collectionGroup('Contatti_Caso');
data._Auth = from === 'memory' ? await source.query('_Auth') : [];
for (const [k, v] of Object.entries(data)) console.log(`  letti ${String(v.length).padStart(5)}  ${k}`);

// 2. pulizia dei riferimenti orfani
const exists = Object.fromEntries(TOP.map((c) => [c, new Set(data[c].map((d) => d.path))]));
let fixed = 0;
function clean(col, doc) {
  const spec = TABLES[col];
  const out = { ...doc };
  for (const [field, target] of Object.entries(spec.refs ?? {})) {
    if (out[field] && !exists[target]?.has(out[field])) { out[field] = null; fixed++; }
  }
  for (const [field, target] of Object.entries(spec.arrays ?? {})) {
    if (Array.isArray(out[field])) {
      const ok = out[field].filter((r) => exists[target]?.has(r));
      fixed += out[field].length - ok.length;
      out[field] = ok;
    }
  }
  delete out.id;
  delete out.path;
  return out;
}

// 3. scrittura in ordine di dipendenza (le cartelle dal livello più alto)
data.Folder.sort((a, b) => (a.Array_Parents?.length ?? 0) - (b.Array_Parents?.length ?? 0));
let written = 0, skipped = 0;
for (const col of TOP) {
  for (const doc of data[col]) {
    const clean_ = clean(col, doc);
    if (col === 'Files' && !clean_.Folder_Ref) { skipped++; continue; }
    await target.set(doc.path, clean_);
    written++;
  }
}
for (const col of ['Contatti', 'Contatti_Caso']) {
  const parentCol = TABLES[col].parent.col;
  for (const doc of data[col]) {
    const parent = doc.path.split('/').slice(0, 2).join('/');
    if (!exists[parentCol].has(parent)) { skipped++; continue; }
    await target.set(doc.path, clean(col, doc));
    written++;
  }
}
for (const acc of data._Auth) {
  await target.set(acc.path, clean('_Auth', acc));
  written++;
}

console.log(`\nImportazione completata: ${written} record scritti, ${skipped} orfani saltati, ${fixed} riferimenti orfani azzerati.`);
if (from === 'firestore') {
  console.log('Nota: le password di Firebase Auth non sono esportabili. Ogni avvocato deve "registrarsi" di nuovo');
  console.log('con la stessa email: l\'account viene collegato automaticamente al suo profilo esistente.');
}
await target.close();
