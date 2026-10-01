import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';

/**
 * Adapter in-memory (persistito su JSON) con la stessa semantica minima di Firestore
 * usata dall'app: where (==, !=, <, <=, >, >=, in, array-contains), orderBy, limit,
 * sotto-collezioni e collectionGroup. Serve per demo/sviluppo senza credenziali Firebase.
 */
export function createMemoryAdapter(file = config.memoryFile) {
  /** @type {Map<string, object>} path documento -> dati */
  let docs = new Map();

  const reviveDate = (k, v) =>
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v) ? new Date(v) : v;

  if (fs.existsSync(file)) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'), reviveDate);
    docs = new Map(Object.entries(raw));
  }

  let saveTimer = null;
  const persist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(Object.fromEntries(docs), null, 1));
    }, 50);
  };

  const newId = () => randomBytes(15).toString("base64url");
  const clone = (v) => structuredClone(v);
  const materialize = (p, data) => ({ id: p.split('/').pop(), path: p, ...clone(data) });

  const cmpVal = (a, b) => {
    if (a instanceof Date) a = a.getTime();
    if (b instanceof Date) b = b.getTime();
    if (a == null && b == null) return 0;
    if (a == null) return -1;
    if (b == null) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  };
  const eq = (a, b) => cmpVal(a, b) === 0;

  function match(doc, [field, op, value]) {
    const v = field === '__id__' ? doc.id : doc[field];
    switch (op) {
      case '==': return v !== undefined && eq(v, value);
      case '!=': return v !== undefined && !eq(v, value);
      case '<': return v != null && cmpVal(v, value) < 0;
      case '<=': return v != null && cmpVal(v, value) <= 0;
      case '>': return v != null && cmpVal(v, value) > 0;
      case '>=': return v != null && cmpVal(v, value) >= 0;
      case 'in': return value.some((x) => eq(v, x));
      case 'array-contains': return Array.isArray(v) && v.some((x) => eq(x, value));
      case 'array-contains-any': return Array.isArray(v) && v.some((x) => value.some((y) => eq(x, y)));
      default: throw new Error(`Operatore non supportato: ${op}`);
    }
  }

  function run(list, { where = [], orderBy = [], limit } = {}) {
    let out = list.filter((d) => where.every((w) => match(d, w)));
    // Firestore esclude i documenti privi del campo di ordinamento
    for (const [field] of orderBy) out = out.filter((d) => d[field] !== undefined);
    if (orderBy.length) {
      out.sort((a, b) => {
        for (const [field, dir = 'asc'] of orderBy) {
          const c = cmpVal(a[field], b[field]);
          if (c) return dir === 'desc' ? -c : c;
        }
        return 0;
      });
    }
    return limit ? out.slice(0, limit) : out;
  }

  const inCollection = (colPath) => {
    const depth = colPath.split('/').length + 1;
    const prefix = colPath + '/';
    return [...docs.entries()]
      .filter(([p]) => p.startsWith(prefix) && p.split('/').length === depth)
      .map(([p, d]) => materialize(p, d));
  };

  return {
    kind: 'memory',
    async get(p) {
      return docs.has(p) ? materialize(p, docs.get(p)) : null;
    },
    async query(colPath, opts) {
      return run(inCollection(colPath), opts);
    },
    async collectionGroup(name, opts) {
      const list = [...docs.entries()]
        .filter(([p]) => { const s = p.split('/'); return s.length % 2 === 0 && s[s.length - 2] === name; })
        .map(([p, d]) => materialize(p, d));
      return run(list, opts);
    },
    async add(colPath, data) {
      const p = `${colPath}/${newId()}`;
      docs.set(p, clone(data));
      persist();
      return materialize(p, docs.get(p));
    },
    async set(p, data, { merge = false } = {}) {
      docs.set(p, merge ? { ...(docs.get(p) ?? {}), ...clone(data) } : clone(data));
      persist();
      return materialize(p, docs.get(p));
    },
    async update(p, data) {
      if (!docs.has(p)) throw Object.assign(new Error(`Documento inesistente: ${p}`), { status: 404 });
      docs.set(p, { ...docs.get(p), ...clone(data) });
      persist();
      return materialize(p, docs.get(p));
    },
    async delete(p) {
      docs.delete(p);
      persist();
    },
    async deleteCollection(colPath) {
      for (const d of inCollection(colPath)) docs.delete(d.path);
      persist();
    },
    newId: () => newId(),
    storage: () => null,
    auth: () => null,
  };
}
