import { getDb } from '../db/index.js';

/**
 * Ricerca dei documenti per contenuto (e per nome) su documenti_testo.
 * - full-text italiano senza accenti: "contratti" trova "contratto", "morosita" trova "morosità";
 *   ogni parola vale anche come prefisso ("fideiuss" trova "fideiussione")
 * - se le parole esatte danno pochi risultati, si aggiungono i documenti con parole
 *   simili (errori di battitura) tramite similarità per trigrammi
 * Ogni risultato riporta l'estratto con i termini trovati tra \u0001 e \u0002
 * (il client li evidenzia senza interpretare HTML) e il contesto: cliente,
 * consulenza o caso, cartella o nota.
 */

export const HL_START = '\u0001';
export const HL_END = '\u0002';
const HEADLINE_OPTS = `StartSel=${HL_START}, StopSel=${HL_END}, MaxFragments=2, MinWords=10, MaxWords=28, FragmentDelimiter=" … "`;

/** "Contratto di locaz" → "contratto:* & locaz:*" (solo lettere e cifre: nessuna sintassi tsquery dall'utente) */
export function toPrefixQuery(q) {
  const words = String(q ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.slice(0, 12).map((w) => `${w}:*`).join(' & ');
}

/** Documenti con contesto: file delle cartelle (risalendo gli antenati) e allegati delle note */
const SOURCES = `
  SELECT d.url, d.nome, d.stato, d.ocr, d.tsv, d.testo, d.aggiornato,
         'file' AS origine, f.id AS file_id, f.folder_ref AS folder_id, fo.titolo AS folder_titolo,
         f.data_caricamento AS data, NULL::text AS nota_id, NULL::text AS nota_titolo, NULL::text AS nota_col,
         ctx.cliente_id, ctx.consulenza_id, ctx.caso_id
    FROM documenti_testo d
    JOIN files f ON f.id = d.file_id
    LEFT JOIN folder fo ON fo.id = f.folder_ref
    LEFT JOIN LATERAL (
      -- la cartella del file o l'antenato più vicino che indica cliente / consulenza / caso
      SELECT (array_agg(x.cliente_id ORDER BY x.ord) FILTER (WHERE x.cliente_id IS NOT NULL))[1] AS cliente_id,
             (array_agg(x.consulenza_id ORDER BY x.ord) FILTER (WHERE x.consulenza_id IS NOT NULL))[1] AS consulenza_id,
             (array_agg(x.caso_id ORDER BY x.ord) FILTER (WHERE x.caso_id IS NOT NULL))[1] AS caso_id
        FROM (SELECT fo.cliente_id, fo.consulenza_id, fo.caso_id, 0::bigint AS ord
              UNION ALL
              SELECT a.cliente_id, a.consulenza_id, a.caso_id, p.ord
                FROM unnest(fo.array_parents) WITH ORDINALITY AS p(id, ord) JOIN folder a ON a.id = p.id) x
    ) ctx ON true
  UNION ALL
  SELECT d.url, d.nome, d.stato, d.ocr, d.tsv, d.testo, d.aggiornato,
         'nota', NULL, NULL, NULL, n.data_creazione, n.id, n.titolo, 'Clienti',
         n.cliente_id, NULL, NULL
    FROM documenti_testo d JOIN note_cliente n ON n.id = d.nota_cliente_id
  UNION ALL
  SELECT d.url, d.nome, d.stato, d.ocr, d.tsv, d.testo, d.aggiornato,
         'nota', NULL, NULL, NULL, n.data_creazione, n.id, n.titolo, 'Consulenze',
         k.cliente_id, n.consulenza_id, NULL
    FROM documenti_testo d JOIN note_consulenza n ON n.id = d.nota_consulenza_id
    LEFT JOIN consulenze k ON k.id = n.consulenza_id
  UNION ALL
  SELECT d.url, d.nome, d.stato, d.ocr, d.tsv, d.testo, d.aggiornato,
         'nota', NULL, NULL, NULL, n.data_creazione, n.id, n.titolo, 'Casi',
         c.cliente_id, NULL, n.caso_id
    FROM documenti_testo d JOIN note_caso n ON n.id = d.nota_caso_id
    LEFT JOIN casi c ON c.id = n.caso_id`;

/**
 * @param {string} q testo cercato
 * @param {{ limit?: number, cliente?: string }} opts cliente: "Clienti/id" per limitare la ricerca
 * @returns {Promise<{ results: object[], indexing: number }>} indexing = documenti ancora in elaborazione
 */
export async function searchDocuments(q, { limit = 50, cliente = null } = {}) {
  const db = await getDb();
  const text = String(q ?? '').trim();
  if (!text) return { results: [], indexing: 0 };
  if (db.kind !== 'postgres') return { results: await searchByName(db, text, limit), indexing: 0 };

  const tsq = toPrefixQuery(text);
  if (!tsq) return { results: [], indexing: 0 };
  const clienteId = cliente ? String(cliente).split('/')[1] : null;
  const max = Math.min(Math.max(Number(limit) || 50, 1), 100);

  const sql = `
    WITH src AS NOT MATERIALIZED (${SOURCES}),
    q AS (SELECT to_tsquery('public.it_unaccent', $1) AS tsq, f_unaccent(lower($2)) AS norm),
    exact AS (
      SELECT src.*, ts_rank_cd(src.tsv, q.tsq, 1) AS rank, false AS simile
        FROM src, q
       WHERE src.tsv @@ q.tsq AND ($3::text IS NULL OR src.cliente_id = $3)
       ORDER BY rank DESC, src.data DESC NULLS LAST
       LIMIT $4
    ),
    fuzzy AS (
      -- solo se le parole esatte non bastano: parole simili (errori di battitura)
      SELECT src.*, word_similarity(q.norm, f_unaccent(lower(coalesce(src.nome, '') || ' ' || coalesce(src.testo, '')))) AS rank, true AS simile
        FROM src, q
       WHERE (SELECT count(*) FROM exact) < 5
         AND q.norm <% f_unaccent(lower(coalesce(src.nome, '') || ' ' || coalesce(src.testo, '')))
         AND src.url NOT IN (SELECT url FROM exact)
         AND ($3::text IS NULL OR src.cliente_id = $3)
       ORDER BY rank DESC
       LIMIT 10
    ),
    hits AS (SELECT * FROM exact UNION ALL SELECT * FROM fuzzy)
    SELECT h.url, h.nome, h.ocr, h.origine, h.file_id, h.folder_id, h.folder_titolo, h.data, h.simile,
           h.nota_id, h.nota_titolo, h.nota_col, h.cliente_id, h.consulenza_id, h.caso_id,
           cl.nome AS cliente_nome, co.titolo AS consulenza_titolo, ca.titolo AS caso_titolo,
           CASE WHEN h.simile THEN left(h.testo, 220)
                ELSE ts_headline('public.it_unaccent', left(coalesce(h.testo, ''), 100000), q.tsq, $5) END AS estratto
      FROM hits h CROSS JOIN q
      LEFT JOIN clienti cl ON cl.id = h.cliente_id
      LEFT JOIN consulenze co ON co.id = h.consulenza_id
      LEFT JOIN casi ca ON ca.id = h.caso_id
     ORDER BY h.simile, h.rank DESC, h.data DESC NULLS LAST`;

  // word_similarity < 0.6 di default: con 0.5 si tollera qualche lettera in più o in meno
  const client = await db.pool.connect();
  let rows;
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL pg_trgm.word_similarity_threshold = 0.5`);
    ({ rows } = await client.query(sql, [tsq, text, clienteId, max, HEADLINE_OPTS]));
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  const { rows: [{ n }] } = await db.pool.query(`SELECT count(*)::int AS n FROM documenti_testo WHERE stato = 'in_attesa'`);
  return { results: rows.map(toResult), indexing: n };
}

function toResult(r) {
  const nota = r.nota_id ? {
    titolo: r.nota_titolo,
    // pagina dell'entità a cui appartiene la nota
    entita: r.nota_col === 'Clienti' ? `Clienti/${r.cliente_id}` : r.nota_col === 'Consulenze' ? `Consulenze/${r.consulenza_id}` : `Casi/${r.caso_id}`,
  } : null;
  return {
    url: r.url,
    nome: r.nome,
    origine: r.origine,          // "file" | "nota"
    ocr: r.ocr,
    simile: r.simile,            // trovato per somiglianza (parole non identiche)
    estratto: (r.estratto ?? '').replace(/\s+/g, ' ').trim(),
    data: r.data,
    file: r.file_id ? `Files/${r.file_id}` : null,
    folder: r.folder_id ? { path: `Folder/${r.folder_id}`, titolo: r.folder_titolo } : null,
    nota,
    cliente: r.cliente_id ? { path: `Clienti/${r.cliente_id}`, nome: r.cliente_nome } : null,
    consulenza: r.consulenza_id ? { path: `Consulenze/${r.consulenza_id}`, titolo: r.consulenza_titolo } : null,
    caso: r.caso_id ? { path: `Casi/${r.caso_id}`, titolo: r.caso_titolo } : null,
  };
}

/** Senza PostgreSQL (database JSON / Firestore): solo per nome file */
async function searchByName(db, text, limit) {
  const norm = (s) => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const terms = norm(text).split(/\s+/).filter(Boolean);
  const files = await db.query('Files');
  return files
    .filter((f) => terms.every((t) => norm(f.Nome).includes(t)))
    .slice(0, limit)
    .map((f) => ({
      url: f.File, nome: f.Nome, origine: 'file', ocr: false, simile: false, estratto: '', data: f.Data_Caricamento,
      file: f.path, folder: f.Folder_Ref ? { path: f.Folder_Ref, titolo: null } : null,
      nota: null, cliente: null, consulenza: null, caso: null,
    }));
}

/** Stato dell'indicizzazione dei file di una cartella (badge nell'esplora documenti) */
export async function indexStatus(fileIds) {
  const db = await getDb();
  if (db.kind !== 'postgres' || !fileIds.length) return {};
  const { rows } = await db.pool.query(
    'SELECT file_id, url, stato, errore, ocr FROM documenti_testo WHERE file_id = ANY($1)', [fileIds],
  );
  return Object.fromEntries(rows.map((r) => [`Files/${r.file_id}`, { url: r.url, stato: r.stato, errore: r.errore, ocr: r.ocr }]));
}
