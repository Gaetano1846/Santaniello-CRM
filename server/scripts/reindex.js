import { getDb } from '../db/index.js';
import { idle, syncIndex } from '../services/indexer.js';
import { closeOcr } from '../services/extract.js';

/**
 * npm run docs:reindex — indicizza i documenti mai elaborati e riprova quelli in errore.
 * Con --tutti rielabora l'intero archivio (es. dopo un miglioramento dell'estrazione).
 */
const db = await getDb();
if (db.kind !== 'postgres') {
  console.error('La ricerca per contenuto richiede PostgreSQL (DATABASE_URL).');
  process.exit(1);
}
if (process.argv.includes('--tutti')) {
  await db.pool.query(`UPDATE documenti_testo SET stato = 'in_attesa', errore = NULL, aggiornato = now() WHERE stato <> 'non_supportato'`);
}
const { added } = await syncIndex({ retryErrors: true });
console.log(`Documenti aggiunti all'indice: ${added}. Elaborazione in corso…`);
await idle();
const { rows } = await db.pool.query('SELECT stato, count(*)::int AS n FROM documenti_testo GROUP BY stato ORDER BY stato');
for (const r of rows) console.log(`  ${r.stato.padEnd(15)} ${r.n}`);
await closeOcr();
await db.close();
