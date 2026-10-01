import { initializeApp, cert, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore, DocumentReference, Timestamp, FieldPath } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getAuth } from 'firebase-admin/auth';
import { config } from '../config.js';
import { schemaFor } from './schema.js';

/**
 * Adapter Firestore reale (firebase-admin). Converte:
 *  - DocumentReference  <-> "Collezione/id"
 *  - Timestamp          <-> Date
 * usando lo schema per sapere quali campi sono riferimenti.
 */
export function createFirestoreAdapter() {
  if (!getApps().length) {
    const credential = config.firebase.serviceAccount
      ? cert(JSON.parse(config.firebase.serviceAccount))
      : applicationDefault();
    initializeApp({
      credential,
      projectId: config.firebase.projectId,
      storageBucket: config.firebase.storageBucket,
    });
  }
  const fs = getFirestore();

  const toRef = (v) => (typeof v === 'string' && v.includes('/') ? fs.doc(v) : v);

  function encode(path, data) {
    const s = schemaFor(path);
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      if (s.refs.includes(k)) out[k] = v ? toRef(v) : null;
      else if (s.refLists.includes(k)) out[k] = Array.isArray(v) ? v.map(toRef) : v;
      else out[k] = v;
    }
    return out;
  }

  function decodeValue(v) {
    if (v instanceof DocumentReference) return v.path;
    if (v instanceof Timestamp) return v.toDate();
    if (Array.isArray(v)) return v.map(decodeValue);
    return v;
  }

  function decode(snap) {
    if (!snap.exists) return null;
    const data = snap.data();
    const out = { id: snap.id, path: snap.ref.path };
    for (const [k, v] of Object.entries(data)) out[k] = decodeValue(v);
    return out;
  }

  function buildQuery(ref, colPath, { where = [], orderBy = [], limit } = {}) {
    let q = ref;
    const s = schemaFor(colPath);
    for (const [field, op, value] of where) {
      let v = value;
      if (field === '__id__') {
        q = q.where(FieldPath.documentId(), op, value);
        continue;
      }
      if (s.refs.includes(field) || s.refLists.includes(field)) {
        v = Array.isArray(value) ? value.map(toRef) : toRef(value);
      }
      q = q.where(field, op, v);
    }
    for (const [field, dir = 'asc'] of orderBy) q = q.orderBy(field, dir);
    if (limit) q = q.limit(limit);
    return q;
  }

  return {
    kind: 'firestore',
    async get(path) {
      return decode(await fs.doc(path).get());
    },
    async query(colPath, opts) {
      const snap = await buildQuery(fs.collection(colPath), colPath, opts).get();
      return snap.docs.map(decode);
    },
    async collectionGroup(name, opts) {
      const snap = await buildQuery(fs.collectionGroup(name), name, opts).get();
      return snap.docs.map(decode);
    },
    async add(colPath, data) {
      const ref = await fs.collection(colPath).add(encode(colPath, data));
      return decode(await ref.get());
    },
    async set(path, data, { merge = false } = {}) {
      await fs.doc(path).set(encode(path, data), { merge });
      return decode(await fs.doc(path).get());
    },
    async update(path, data) {
      await fs.doc(path).update(encode(path, data));
      return decode(await fs.doc(path).get());
    },
    async delete(path) {
      await fs.doc(path).delete();
    },
    async deleteCollection(colPath, batchSize = 500) {
      // come deleteSubcollection() dell'originale: batch da 500 finché vuota
      for (;;) {
        const snap = await fs.collection(colPath).limit(batchSize).get();
        if (snap.empty) break;
        const batch = fs.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    },
    newId(colPath) {
      return fs.collection(colPath).doc().id;
    },
    // accesso ai servizi Firebase condivisi
    storage: () => getStorage(),
    auth: () => getAuth(),
  };
}
