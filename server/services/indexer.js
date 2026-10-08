import { getDb } from '../db/index.js';
import { extractText, isSupported, UnsupportedError } from './extract.js';
import { readStoredFile } from './storage.js';

/**
 * Indicizzazione del contenuto dei documenti (solo con PostgreSQL).
 * Ogni file caricato riceve una riga in documenti_testo con stato "in_attesa";
 * una coda in-process estrae il testo un file alla volta (l'OCR è pesante) e
 * riprende da sola dopo un riavvio, perché lo stato vive nel database.
 */

/** Collezione padre della nota → colonna di documenti_testo */
const NOTA_FK = { Clienti: 'nota_cliente_id', Consulenze: 'nota_consulenza_id', Casi: 'nota_caso_id' };

async function pool() {
  const db = await getDb();
  return db.kind === 'postgres' ? db.pool : null;
}

/** Mette in coda i file (nuovi o da rielaborare) e avvia la coda */
async function enqueue(rows) {
  const p = await pool();
  if (!p || !rows.length) return;
  for (const r of rows) {
    await p.query(
      `INSERT INTO documenti_testo (url, nome, file_id, nota_cliente_id, nota_consulenza_id, nota_caso_id, stato, errore, testo, ocr, aggiornato)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL, false, now())
       ON CONFLICT (url) DO UPDATE SET nome = EXCLUDED.nome, stato = EXCLUDED.stato, errore = NULL, aggiornato = now()`,
      [r.url, r.nome, r.file_id ?? null, r.nota_cliente_id ?? null, r.nota_consulenza_id ?? null, r.nota_caso_id ?? null,
        isSupported(r.nome) ? 'in_attesa' : 'non_supportato'],
    );
  }
  kick();
}

/** File delle cartelle appena caricati (documenti Files) */
export const indexFiles = (files) => enqueue(files.map((f) => ({ url: f.File, nome: f.Nome, file_id: f.id })));

/** Allegati di una nota: notaPath = "Clienti/a/Note_Cliente/b" */
export function indexAllegati(notaPath, allegati) {
  const [col, , , id] = notaPath.split('/');
  return enqueue(allegati.map((a) => ({ url: a.File, nome: a.Nome, [NOTA_FK[col]]: id })));
}

/** Allegati rimossi da una nota (la nota eliminata pulisce da sé, per cascata) */
export async function unindex(urls) {
  const p = await pool();
  if (p && urls.length) await p.query('DELETE FROM documenti_testo WHERE url = ANY($1)', [urls]);
}

/** Rimette in coda un documento (pulsante "Riprova") */
export async function reindex(url) {
  const p = await pool();
  if (!p) return false;
  const r = await p.query(
    `UPDATE documenti_testo SET stato = 'in_attesa', errore = NULL, aggiornato = now() WHERE url = $1 AND stato <> 'non_supportato'`,
    [url],
  );
  kick();
  return r.rowCount > 0;
}

/**
 * Allinea l'indice all'archivio: aggiunge i file e gli allegati mai indicizzati
 * (es. caricati prima di questa funzione o importati) e riprende la coda.
 * @param {{ retryErrors?: boolean }} opts retryErrors: rielabora anche i file andati in errore
 */
export async function syncIndex({ retryErrors = false } = {}) {
  const p = await pool();
  if (!p) return { added: 0 };
  const { rows } = await p.query(`
    SELECT f.file AS url, f.nome, f.id AS file_id, NULL AS nota_cliente_id, NULL AS nota_consulenza_id, NULL AS nota_caso_id
      FROM files f WHERE f.file IS NOT NULL
    UNION ALL SELECT a->>'File', a->>'Nome', NULL, n.id, NULL, NULL FROM note_cliente n, jsonb_array_elements(n.allegati) a
    UNION ALL SELECT a->>'File', a->>'Nome', NULL, NULL, n.id, NULL FROM note_consulenza n, jsonb_array_elements(n.allegati) a
    UNION ALL SELECT a->>'File', a->>'Nome', NULL, NULL, NULL, n.id FROM note_caso n, jsonb_array_elements(n.allegati) a`);
  const known = new Set((await p.query('SELECT url FROM documenti_testo')).rows.map((r) => r.url));
  const missing = rows.filter((r) => r.url && !known.has(r.url));
  if (retryErrors) await p.query(`UPDATE documenti_testo SET stato = 'in_attesa', errore = NULL WHERE stato = 'errore'`);
  await enqueue(missing.map((r) => ({ ...r, nome: r.nome ?? 'documento' })));
  kick();
  return { added: missing.length };
}

/* ------------------------------------------------------------ coda */

let running = null;
let again = false;

/** Avvia l'elaborazione (se non è già in corso) */
export function kick() {
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      do {
        again = false;
        while (await processNext()) { /* un file alla volta */ }
      } while (again);
    } catch (e) {
      console.error('Indicizzazione documenti interrotta:', e.message);
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Attende che la coda sia vuota (test, comandi da terminale) */
export async function idle() {
  while (running) await running;
}

async function processNext() {
  const p = await pool();
  if (!p) return false;
  const { rows: [doc] } = await p.query(
    `SELECT url, nome, aggiornato::text AS ver FROM documenti_testo WHERE stato = 'in_attesa' ORDER BY aggiornato LIMIT 1`,
  );
  if (!doc) return false;
  const started = Date.now();
  let set;
  try {
    const { testo, ocr } = await extractText(await readStoredFile(doc.url), doc.nome);
    set = { stato: 'indicizzato', errore: null, testo, ocr };
    console.log(`  documento indicizzato: ${doc.nome} (${testo.length} caratteri${ocr ? ', OCR' : ''}, ${Date.now() - started} ms)`);
  } catch (e) {
    set = e instanceof UnsupportedError
      ? { stato: 'non_supportato', errore: e.message, testo: null, ocr: false }
      : { stato: 'errore', errore: friendlyError(e), testo: null, ocr: false };
    if (set.stato === 'errore') console.warn(`  indicizzazione fallita: ${doc.nome}: ${e?.message ?? e}`);
  }
  // se nel frattempo il file è stato rimesso in coda (aggiornato è cambiato) la riga resta "in_attesa"
  await p.query(
    `UPDATE documenti_testo SET stato = $2, errore = $3, testo = $4, ocr = $5, aggiornato = now()
      WHERE url = $1 AND aggiornato::text = $6`,
    [doc.url, set.stato, set.errore, set.testo, set.ocr, doc.ver],
  );
  return true;
}

function friendlyError(e) {
  // tesseract.js rifiuta con una stringa, non con un Error
  const msg = String(e?.message ?? e);
  if (e?.code === 'ENOENT') return 'File non trovato nello storage';
  if (/central directory|zip file|not a valid|non è un PDF|Invalid PDF|read image|no pix/i.test(msg)) return 'File danneggiato o in un formato non leggibile';
  if (/password/i.test(msg)) return 'Documento protetto da password';
  return msg.slice(0, 300);
}
