import { config } from '../config.js';
import { createMemoryAdapter } from './memory.js';

let dbPromise;

async function init() {
  if (config.dataDriver === 'postgres') {
    const { createPostgresAdapter } = await import('./postgres/index.js');
    return createPostgresAdapter(config.databaseUrl);
  }
  if (config.dataDriver === 'firestore') {
    const { createFirestoreAdapter } = await import('./firestore.js');
    return createFirestoreAdapter();
  }
  return createMemoryAdapter();
}

/** Restituisce l'adapter dati attivo (PostgreSQL, Firestore o memoria locale). */
export function getDb() {
  dbPromise ??= init().catch((e) => { dbPromise = undefined; throw e; });
  return dbPromise;
}
