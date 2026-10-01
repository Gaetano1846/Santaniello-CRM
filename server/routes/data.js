import { Router } from 'express';
import { getDb } from '../db/index.js';
import { schema, schemaFor } from '../db/schema.js';

/**
 * API dati generica "stile Firestore", equivalente alle query che l'app Flutter
 * eseguiva direttamente dal client. Accetta solo collezioni e campi dello schema.
 *
 *   GET    /api/data/<collezione>[/<id>/<sotto>]?q={"where":[...],"orderBy":[...],"limit":n}
 *   GET    /api/group/<collezione>?q=...          (collectionGroup)
 *   GET    /api/doc/<path documento>
 *   POST   /api/data/<collezione>                 body = campi
 *   PATCH  /api/doc/<path documento>              body = campi
 *   DELETE /api/doc/<path documento>
 *
 * Il valore speciale "__now__" in un campo data equivale a FieldValue.serverTimestamp().
 */
export const dataRouter = Router();

const OPS = new Set(['==', '!=', '<', '<=', '>', '>=', 'in', 'array-contains', 'array-contains-any']);

function assertPath(segments, wantDoc) {
  if (!segments.length || segments.length % 2 !== (wantDoc ? 0 : 1)) {
    throw Object.assign(new Error('Percorso non valido'), { status: 400 });
  }
  for (let i = 0; i < segments.length; i += 2) {
    if (!schema[segments[i]]) throw Object.assign(new Error(`Collezione non consentita: ${segments[i]}`), { status: 403 });
  }
  for (let i = 1; i < segments.length; i += 2) {
    if (!/^[\w-]{1,128}$/.test(segments[i])) throw Object.assign(new Error('Id non valido'), { status: 400 });
  }
  return segments.join('/');
}

const segs = (req) => [].concat(req.params.path ?? []).flatMap((s) => s.split('/')).filter(Boolean);

function coerceIn(path, body, { partial = false } = {}) {
  const s = schemaFor(path);
  const out = {};
  for (const [k, v] of Object.entries(body ?? {})) {
    if (!s.fields.includes(k)) continue; // ignora campi fuori schema
    if (s.dates.includes(k)) out[k] = v === '__now__' ? new Date() : v ? new Date(v) : null;
    else if (s.ints?.includes(k)) out[k] = v === '' || v == null ? null : Number.parseInt(String(v).replace(/\D/g, ''), 10) || 0;
    else out[k] = v;
  }
  if (!partial && !Object.keys(out).length) throw Object.assign(new Error('Nessun campo valido'), { status: 400 });
  return out;
}

function parseQuery(path, raw) {
  if (!raw) return {};
  const q = JSON.parse(raw);
  const s = schemaFor(path);
  const where = (q.where ?? []).map(([f, op, v]) => {
    if (!OPS.has(op)) throw Object.assign(new Error(`Operatore non valido: ${op}`), { status: 400 });
    if (f !== '__id__' && !s.fields.includes(f)) throw Object.assign(new Error(`Campo non valido: ${f}`), { status: 400 });
    return [f, op, s.dates.includes(f) && v ? new Date(v) : v];
  });
  const orderBy = (q.orderBy ?? []).map(([f, d]) => {
    if (!s.fields.includes(f)) throw Object.assign(new Error(`Campo non valido: ${f}`), { status: 400 });
    return [f, d === 'desc' ? 'desc' : 'asc'];
  });
  const limit = q.limit ? Math.min(Number(q.limit), 5000) : undefined;
  return { where, orderBy, limit };
}

dataRouter.get('/data/*path', async (req, res) => {
  const colPath = assertPath(segs(req), false);
  const db = await getDb();
  res.json(await db.query(colPath, parseQuery(colPath, req.query.q)));
});

dataRouter.get('/group/:name', async (req, res) => {
  const { name } = req.params;
  if (!schema[name]) return res.status(403).json({ error: 'Collezione non consentita' });
  const db = await getDb();
  res.json(await db.collectionGroup(name, parseQuery(name, req.query.q)));
});

dataRouter.get('/doc/*path', async (req, res) => {
  const p = assertPath(segs(req), true);
  const db = await getDb();
  const doc = await db.get(p);
  if (!doc) return res.status(404).json({ error: 'Documento non trovato' });
  res.json(doc);
});

dataRouter.post('/data/*path', async (req, res) => {
  const colPath = assertPath(segs(req), false);
  const db = await getDb();
  res.status(201).json(await db.add(colPath, coerceIn(colPath, req.body)));
});

dataRouter.patch('/doc/*path', async (req, res) => {
  const p = assertPath(segs(req), true);
  const db = await getDb();
  res.json(await db.update(p, coerceIn(p, req.body, { partial: true })));
});

dataRouter.delete('/doc/*path', async (req, res) => {
  const p = assertPath(segs(req), true);
  const db = await getDb();
  await db.delete(p);
  res.status(204).end();
});
