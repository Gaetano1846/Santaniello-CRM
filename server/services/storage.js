import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { getDb } from '../db/index.js';

/**
 * Upload/cancellazione file. In modalità Firestore usa Firebase Storage e produce lo
 * stesso formato di URL dell'app Flutter (getDownloadURL con token), così i documenti
 * Files restano compatibili in entrambe le direzioni.
 */

/** Stesso path dell'originale (SimpleDropZone): files/<millisecondi>_<nomefile> */
export const storagePathFor = (fileName) => `files/${Date.now()}_${fileName}`;

/** Porting di extractStoragePathFromUrl(): estrae il path dopo "/o/" e lo decodifica */
export function extractStoragePathFromUrl(url) {
  try {
    if (!url) return null;
    const u = new URL(url, 'http://local');
    const i = u.pathname.indexOf('/o/');
    if (i === -1) return null;
    return decodeURIComponent(u.pathname.slice(i + 3));
  } catch {
    return null;
  }
}

function bucketFromUrl(url) {
  try {
    const m = new URL(url, 'http://local').pathname.match(/\/b\/([^/]+)\/o\//);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function uploadFile({ buffer, originalName, contentType }) {
  const db = await getDb();
  const storagePath = storagePathFor(originalName);

  if (db.kind === 'firestore') {
    const bucket = db.storage().bucket(config.firebase.storageBucket);
    const token = randomUUID();
    await bucket.file(storagePath).save(buffer, {
      contentType,
      metadata: { contentType, metadata: { firebaseStorageDownloadTokens: token } },
      resumable: false,
    });
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
    return { url, storagePath };
  }

  const dest = path.join(config.uploadsDir, storagePath);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, buffer);
  // stesso schema /o/<path> così extractStoragePathFromUrl funziona anche in locale
  const url = `/storage/v0/b/local/o/${encodeURIComponent(storagePath)}?alt=media`;
  return { url, storagePath };
}

/** Contenuto di un file caricato (per l'estrazione del testo) */
export async function readStoredFile(url) {
  const storagePath = extractStoragePathFromUrl(url);
  if (!storagePath) throw new Error('URL del file non valido');
  const db = await getDb();
  if (db.kind === 'firestore') {
    const [buf] = await db.storage().bucket(bucketFromUrl(url) ?? config.firebase.storageBucket).file(storagePath).download();
    return buf;
  }
  const abs = path.resolve(config.uploadsDir, storagePath);
  if (!abs.startsWith(path.resolve(config.uploadsDir) + path.sep)) throw new Error('Percorso del file non valido');
  return fs.readFile(abs);
}

/**
 * Porting di deleteFileFromStorage():prova URL completo su entrambi i bucket
 * (con/senza "e"), poi il path estratto, poi "files/<nome>" se il valore è solo un nome.
 * Un file già assente viene considerato un successo (come nell'originale).
 */
export async function deleteStoredFile(fileValue) {
  if (!fileValue) return true;
  const db = await getDb();
  const isFullUrl = fileValue.includes('https://') || fileValue.includes('firebasestorage') || fileValue.startsWith('/storage/');
  const storagePath = isFullUrl ? extractStoragePathFromUrl(fileValue) : `files/${fileValue}`;
  if (!storagePath) return false;

  if (db.kind !== 'firestore') {
    try {
      await fs.unlink(path.join(config.uploadsDir, storagePath));
    } catch (e) {
      if (e.code !== 'ENOENT') return false;
    }
    return true;
  }

  const buckets = [...new Set([bucketFromUrl(fileValue), config.firebase.storageBucket, config.firebase.altStorageBucket].filter(Boolean))];
  let notFoundEverywhere = true;
  for (const name of buckets) {
    try {
      await db.storage().bucket(name).file(storagePath).delete();
      return true;
    } catch (e) {
      if (e.code !== 404) notFoundEverywhere = false;
    }
  }
  return notFoundEverywhere;
}
