import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/**
 * Adapter PostgreSQL. Espone la stessa interfaccia "a documenti" degli adapter Firestore
 * e memoria (path "Collezione/id", riferimenti come path), traducendola su tabelle
 * relazionali con chiavi esterne. Così tutto il resto del server resta invariato.
 */

// bigint (telefono) → Number
pg.types.setTypeParser(20, (v) => Number(v));

const note = (table, col, fk) => ({
  table,
  parent: { col, fk },
  cols: { Titolo: 'titolo', Descrizione: 'descrizione', Data_Creazione: 'data_creazione', Utente: 'utente', Allegati: 'allegati' },
  refs: { Utente: 'Users' },
  jsonCols: { Allegati: true },
});

/** Collezione → tabella, campo → colonna, riferimenti (collezione di destinazione), sotto-collezioni */
const T = {
  Users: { table: 'users', cols: { email: 'email', display_name: 'display_name', photo_url: 'photo_url', uid: 'uid', created_time: 'created_time', phone_number: 'phone_number' } },
  _Auth: { table: 'auth_accounts', cols: { email: 'email', hash: 'hash', salt: 'salt' } },
  Clienti: { table: 'clienti', cols: { Nome: 'nome', Partita_IVA: 'partita_iva', Email: 'email', Telefono: 'telefono', indirizzo: 'indirizzo', Caso_Aperto: 'caso_aperto', Categoria: 'categoria', Note: 'note' } },
  Contatti: { table: 'contatti', parent: { col: 'Clienti', fk: 'cliente_id' }, cols: { Nome: 'nome', Email: 'email', Telefono: 'telefono', Data_Creazione: 'data_creazione' } },
  Note_Cliente: note('note_cliente', 'Clienti', 'cliente_id'),
  Note_Consulenza: note('note_consulenza', 'Consulenze', 'consulenza_id'),
  Note_Caso: note('note_caso', 'Casi', 'caso_id'),
  Consulenze: {
    table: 'consulenze',
    cols: { Cliente: 'cliente_id', Titolo: 'titolo', Descrizione: 'descrizione', Avvocato_Principale: 'avvocato_principale', Data_Creazione: 'data_creazione', Data_Inizio: 'data_inizio', Avvocati_Supporto: 'avvocati_supporto' },
    refs: { Cliente: 'Clienti', Avvocato_Principale: 'Users' },
    arrays: { Avvocati_Supporto: 'Users' },
  },
  Casi: {
    table: 'casi',
    cols: { Titolo: 'titolo', Cliente: 'cliente_id', Area_Pratica: 'area_pratica', Data_Creazione: 'data_creazione', Avvocato_Principale: 'avvocato_principale', Avvovati_Supporto: 'avvovati_supporto', Data_Inizio: 'data_inizio', Scadenza: 'scadenza', Descrizione: 'descrizione' },
    refs: { Cliente: 'Clienti', Avvocato_Principale: 'Users' },
    arrays: { Avvovati_Supporto: 'Users' },
  },
  Contatti_Caso: { table: 'contatti_caso', parent: { col: 'Casi', fk: 'caso_id' }, cols: { Nome: 'nome', Email: 'email', Telefono: 'telefono', Data_Creazione: 'data_creazione' } },
  Folder: {
    table: 'folder',
    cols: { Titolo: 'titolo', Data_Creazione: 'data_creazione', Cliente: 'cliente_id', Consulenza: 'consulenza_id', Caso: 'caso_id', Parent_Folder: 'parent_folder', Array_Parents: 'array_parents' },
    refs: { Cliente: 'Clienti', Consulenza: 'Consulenze', Caso: 'Casi', Parent_Folder: 'Folder' },
    arrays: { Array_Parents: 'Folder' },
  },
  Files: {
    table: 'files',
    cols: { Nome: 'nome', Data_Caricamento: 'data_caricamento', File: 'file', Folder_Ref: 'folder_ref' },
    refs: { Folder_Ref: 'Folder' },
  },
  VersioneFile: { table: 'versione_file', parent: { col: 'Files', fk: 'file_id' }, cols: {}, json: 'data' },
  Activity: {
    table: 'activity',
    cols: { Titolo: 'titolo', Data: 'data', Utente: 'utente', Cliente: 'cliente_id', Consulenza: 'consulenza_id', Caso: 'caso_id' },
    refs: { Utente: 'Users', Cliente: 'Clienti', Consulenza: 'Consulenze', Caso: 'Casi' },
  },
  Promemoria: {
    table: 'promemoria',
    cols: { Data_Creazione: 'data_creazione', Titolo: 'titolo', Descrizione: 'descrizione', Data_Promemoria: 'data_promemoria', Utente: 'utente', Ora_Promemoria: 'ora_promemoria', Consulenza_Ref: 'consulenza_ref' },
    refs: { Utente: 'Users', Consulenza_Ref: 'Consulenze' },
  },
  Appuntamenti: {
    table: 'appuntamenti',
    cols: { Titolo: 'titolo', Descrizione: 'descrizione', Data_Creazione: 'data_creazione', Data_Appuntamento: 'data_appuntamento', Ora_Appuntamento: 'ora_appuntamento', Luogo: 'luogo', Utente: 'utente', Consulenza_Ref: 'consulenza_ref' },
    refs: { Utente: 'Users', Consulenza_Ref: 'Consulenze' },
  },
};

const notFound = (msg) => Object.assign(new Error(msg), { status: 404 });
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const q = (ident) => `"${ident}"`;

/** "Clienti" | "Clienti/abc/Contatti" → { spec, name, parentId } */
function resolveCollection(colPath) {
  const s = colPath.split('/').filter(Boolean);
  if (s.length % 2 === 0) throw bad(`Percorso di collezione non valido: ${colPath}`);
  const name = s[s.length - 1];
  const spec = T[name];
  if (!spec) throw notFound(`Collezione non gestita: ${name}`);
  if (s.length === 1) {
    if (spec.parent) throw bad(`${name} è una sotto-collezione`);
    return { spec, name, parentId: null };
  }
  if (!spec.parent || spec.parent.col !== s[s.length - 3]) throw notFound(`Sotto-collezione non gestita: ${colPath}`);
  return { spec, name, parentId: s[s.length - 2], parentPath: s.slice(0, -1).join('/') };
}

function resolveDoc(docPath) {
  const s = docPath.split('/').filter(Boolean);
  if (s.length % 2 !== 0 || !s.length) throw bad(`Percorso di documento non valido: ${docPath}`);
  return { ...resolveCollection(s.slice(0, -1).join('/')), id: s[s.length - 1] };
}

/** path di riferimento → id (accetta anche un id nudo) */
function refToId(value, target, field) {
  if (value == null || value === '') return null;
  const s = String(value);
  if (!s.includes('/')) return s;
  const [col, id, ...rest] = s.split('/');
  if (col !== target || !id || rest.length) throw bad(`Riferimento non valido per ${field}: ${s}`);
  return id;
}

function toRow(spec, data) {
  const row = {};
  for (const [field, value] of Object.entries(data)) {
    if (value === undefined) continue;
    const col = spec.cols[field];
    if (!col) {
      if (spec.json) row[spec.json] = { ...(row[spec.json] ?? {}), [field]: value };
      continue;
    }
    if (spec.refs?.[field]) row[col] = refToId(value, spec.refs[field], field);
    else if (spec.arrays?.[field]) row[col] = (Array.isArray(value) ? value : []).map((v) => refToId(v, spec.arrays[field], field)).filter(Boolean);
    // pg serializzerebbe un array JS come array PostgreSQL, non come JSON
    else if (spec.jsonCols?.[field]) row[col] = JSON.stringify(value ?? []);
    else row[col] = value;
  }
  return row;
}

function toDoc(spec, name, row, parentPath) {
  const base = parentPath ? `${parentPath}/${name}` : name;
  const doc = { id: row.id, path: `${base}/${row.id}` };
  for (const [field, col] of Object.entries(spec.cols)) {
    const v = row[col];
    if (v == null) continue; // come Firestore: campo assente
    if (spec.refs?.[field]) doc[field] = `${spec.refs[field]}/${v}`;
    else if (spec.arrays?.[field]) doc[field] = v.map((id) => `${spec.arrays[field]}/${id}`);
    else doc[field] = v;
  }
  if (spec.json && row[spec.json]) Object.assign(doc, row[spec.json]);
  return doc;
}

const parentPathOf = (spec, row) => (spec.parent ? `${spec.parent.col}/${row[spec.parent.fk]}` : null);

/** where/orderBy/limit in stile Firestore → SQL */
function buildSelect(spec, { where = [], orderBy = [], limit } = {}, base = []) {
  const params = [];
  const conds = [...base.map(([col, v]) => { params.push(v); return `${q(col)} = $${params.length}`; })];
  const p = (v) => { params.push(v); return `$${params.length}`; };

  for (const [field, op, raw] of where) {
    const col = field === '__id__' ? 'id' : spec.cols[field];
    if (!col) throw bad(`Campo non valido: ${field}`);
    const isRef = !!spec.refs?.[field];
    const isArr = !!spec.arrays?.[field];
    const conv = (v) => (isRef ? refToId(v, spec.refs[field], field) : isArr ? refToId(v, spec.arrays[field], field) : v);
    const c = q(col);
    switch (op) {
      case '==': conds.push(raw == null ? `${c} IS NULL` : `${c} = ${p(conv(raw))}`); break;
      case '!=': conds.push(raw == null ? `${c} IS NOT NULL` : `${c} IS NOT NULL AND ${c} <> ${p(conv(raw))}`); break;
      case '<': case '<=': case '>': case '>=': conds.push(`${c} ${op} ${p(conv(raw))}`); break;
      case 'in': conds.push(`${c} = ANY(${p((raw ?? []).map(conv))})`); break;
      case 'array-contains': conds.push(`${p(conv(raw))} = ANY(${c})`); break;
      case 'array-contains-any': conds.push(`${c} && ${p((raw ?? []).map(conv))}::text[]`); break;
      default: throw bad(`Operatore non supportato: ${op}`);
    }
  }
  const order = orderBy.map(([field, dir]) => {
    const col = spec.cols[field];
    if (!col) throw bad(`Campo non valido: ${field}`);
    conds.push(`${q(col)} IS NOT NULL`); // Firestore esclude i documenti senza il campo
    return `${q(col)} ${dir === 'desc' ? 'DESC' : 'ASC'}`;
  });
  let sql = `SELECT * FROM ${q(spec.table)}`;
  if (conds.length) sql += ` WHERE ${conds.join(' AND ')}`;
  sql += ` ORDER BY ${order.length ? `${order.join(', ')}, ` : ''}id`;
  if (limit) sql += ` LIMIT ${p(Number(limit))}`;
  return { sql, params };
}

const newId = () => randomBytes(15).toString('base64url');

/** Crea il database se non esiste, poi applica lo schema */
async function ensureDatabase(url) {
  const pool = new pg.Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX ?? 10) });
  try {
    await pool.query('SELECT 1');
  } catch (e) {
    if (e.code !== '3D000') throw e; // 3D000 = database inesistente
    await pool.end();
    const u = new URL(url);
    const dbName = decodeURIComponent(u.pathname.slice(1));
    u.pathname = '/postgres';
    const admin = new pg.Client({ connectionString: u.toString() });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${q(dbName.replace(/"/g, ''))}`);
    await admin.end();
    console.log(`     database "${dbName}" creato`);
    return ensureDatabase(url);
  }
  const ddl = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf8');
  await pool.query(ddl);
  return pool;
}

export async function createPostgresAdapter(url) {
  if (!url) throw new Error('DATABASE_URL non configurata');
  const pool = await ensureDatabase(url);
  // un client inattivo che perde la connessione non deve far cadere il processo
  pool.on('error', (e) => console.warn('PostgreSQL: connessione persa', e.message));

  const CONN_ERRORS = new Set(['ECONNRESET', 'EPIPE', 'ECONNREFUSED', '57P01', '08006', '08003']);
  /** query con un nuovo tentativo se la connessione è caduta */
  async function run(sql, params) {
    try {
      return await pool.query(sql, params);
    } catch (e) {
      if (!CONN_ERRORS.has(e.code) && !/Connection terminated/.test(e.message)) throw e;
      return pool.query(sql, params);
    }
  }
  const one = async (sql, params) => (await run(sql, params)).rows[0] ?? null;

  const adapter = {
    kind: 'postgres',
    pool,

    async get(docPath) {
      const { spec, name, id, parentId, parentPath } = resolveDoc(docPath);
      const base = [['id', id], ...(parentId ? [[spec.parent.fk, parentId]] : [])];
      const { sql, params } = buildSelect(spec, {}, base);
      const row = await one(sql, params);
      return row ? toDoc(spec, name, row, parentPath) : null;
    },

    async query(colPath, opts) {
      const { spec, name, parentId, parentPath } = resolveCollection(colPath);
      const { sql, params } = buildSelect(spec, opts, parentId ? [[spec.parent.fk, parentId]] : []);
      return (await run(sql, params)).rows.map((r) => toDoc(spec, name, r, parentPath));
    },

    async collectionGroup(name, opts) {
      const spec = T[name];
      if (!spec) throw notFound(`Collezione non gestita: ${name}`);
      const { sql, params } = buildSelect(spec, opts);
      return (await run(sql, params)).rows.map((r) => toDoc(spec, name, r, parentPathOf(spec, r)));
    },

    async add(colPath, data) {
      return adapter.set(`${colPath}/${newId()}`, data);
    },

    /** set(): sostituisce il documento; con merge aggiorna solo i campi passati */
    async set(docPath, data, { merge = false } = {}) {
      const { spec, name, id, parentId, parentPath } = resolveDoc(docPath);
      const row = { id, ...(parentId ? { [spec.parent.fk]: parentId } : {}), ...toRow(spec, data) };
      const cols = Object.keys(row);
      const params = cols.map((c) => row[c]);
      const allCols = [...new Set([...Object.values(spec.cols), ...(spec.json ? [spec.json] : [])])];
      const updateCols = merge ? cols.filter((c) => c !== 'id') : allCols;
      const sets = updateCols.map((c) => `${q(c)} = EXCLUDED.${q(c)}`);
      const sql = `INSERT INTO ${q(spec.table)} (${cols.map(q).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
        ON CONFLICT (id) DO ${sets.length ? `UPDATE SET ${sets.join(', ')}` : 'NOTHING'} RETURNING *`;
      const r = (await one(sql, params)) ?? (await one(`SELECT * FROM ${q(spec.table)} WHERE id = $1`, [id]));
      return toDoc(spec, name, r, parentPath);
    },

    async update(docPath, data) {
      const { spec, name, id, parentId, parentPath } = resolveDoc(docPath);
      const row = toRow(spec, data);
      const cols = Object.keys(row);
      if (!cols.length) {
        const cur = await adapter.get(docPath);
        if (!cur) throw notFound(`Documento inesistente: ${docPath}`);
        return cur;
      }
      const params = [...cols.map((c) => row[c]), id, ...(parentId ? [parentId] : [])];
      const sql = `UPDATE ${q(spec.table)} SET ${cols.map((c, i) => `${q(c)} = $${i + 1}`).join(', ')}
        WHERE id = $${cols.length + 1}${parentId ? ` AND ${q(spec.parent.fk)} = $${cols.length + 2}` : ''} RETURNING *`;
      const r = await one(sql, params);
      if (!r) throw notFound(`Documento inesistente: ${docPath}`);
      return toDoc(spec, name, r, parentPath);
    },

    async delete(docPath) {
      const { spec, id, parentId } = resolveDoc(docPath);
      await run(
        `DELETE FROM ${q(spec.table)} WHERE id = $1${parentId ? ` AND ${q(spec.parent.fk)} = $2` : ''}`,
        parentId ? [id, parentId] : [id],
      );
    },

    async deleteCollection(colPath) {
      let r;
      try { r = resolveCollection(colPath); } catch { return; } // sotto-collezioni inesistenti: niente da fare
      const { spec, parentId } = r;
      if (parentId) await run(`DELETE FROM ${q(spec.table)} WHERE ${q(spec.parent.fk)} = $1`, [parentId]);
      else await run(`DELETE FROM ${q(spec.table)}`);
    },

    newId: () => newId(),
    storage: () => null,
    auth: () => null,
    close: () => pool.end(),
  };
  return adapter;
}

export const TABLES = T;
