import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const env = process.env;

export const config = {
  root,
  port: Number(env.PORT ?? 4310),
  isProd: env.NODE_ENV === 'production',

  /**
   * 'postgres'  = database PostgreSQL (DATABASE_URL)
   * 'firestore' = progetto Firebase dell'app originale
   * 'memory'    = demo locale persistita su file JSON
   */
  dataDriver: env.DATA_DRIVER ?? (env.DATABASE_URL ? 'postgres'
    : env.GOOGLE_APPLICATION_CREDENTIALS || env.FIREBASE_SERVICE_ACCOUNT ? 'firestore' : 'memory'),
  databaseUrl: env.DATABASE_URL ?? '',
  memoryFile: path.resolve(root, env.MEMORY_DB_FILE ?? 'data/db.json'),
  uploadsDir: path.resolve(root, env.UPLOADS_DIR ?? 'data/uploads'),

  sessionSecret: env.SESSION_SECRET ?? 'dev-only-secret-change-me',
  sessionDays: Number(env.SESSION_DAYS ?? 14),

  firebase: {
    projectId: env.FIREBASE_PROJECT_ID ?? 'santantanielloe-associa-ltshyc',
    webApiKey: env.FIREBASE_WEB_API_KEY ?? '',
    serviceAccount: env.FIREBASE_SERVICE_ACCOUNT ?? '', // JSON inline (alternativa a GOOGLE_APPLICATION_CREDENTIALS)
    storageBucket: env.FIREBASE_STORAGE_BUCKET ?? 'santantanielloe-associa-ltshyc.firebasestorage.app',
    // L'app originale prova anche il bucket "senza e" per via di un refuso storico nel nome
    altStorageBucket: env.FIREBASE_ALT_STORAGE_BUCKET ?? 'santantaniello-associa-ltshyc.firebasestorage.app',
  },

  algolia: {
    appId: env.ALGOLIA_APP_ID ?? '',
    searchKey: env.ALGOLIA_SEARCH_KEY ?? '',
  },
};
