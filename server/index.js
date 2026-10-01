import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { config } from './config.js';
import { getDb } from './db/index.js';
import { requireAuth } from './services/auth.js';
import { authRouter } from './routes/auth.js';
import { dataRouter } from './routes/data.js';
import { domainRouter } from './routes/domain.js';

const app = express();
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'font-src': ["'self'", 'https://fonts.gstatic.com'],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'img-src': ["'self'", 'data:', 'blob:', 'https://firebasestorage.googleapis.com'],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

app.get('/api/health', async (_req, res) => {
  const db = await getDb();
  res.json({ ok: true, driver: db.kind, node: process.version });
});

app.use('/api', authRouter);
app.use('/api', requireAuth, dataRouter);
app.use('/api', requireAuth, domainRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint non trovato' }));

// File caricati in modalità demo (stesso schema URL di Firebase Storage: /o/<path codificato>)
app.get('/storage/v0/b/local/o/:encoded', requireAuth, (req, res) => {
  const rel = decodeURIComponent(req.params.encoded);
  const abs = path.resolve(config.uploadsDir, rel);
  if (!abs.startsWith(config.uploadsDir + path.sep)) return res.status(400).end();
  res.download(abs, path.basename(rel).replace(/^\d+_/, ''));
});

// Frontend (build di Vite)
const dist = path.join(config.root, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// Errori: messaggio leggibile per il client
app.use((err, _req, res, _next) => {
  const status = err.status ?? (err instanceof SyntaxError ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && config.isProd ? 'Errore interno del server' : err.message });
});

let db;
try {
  db = await getDb();
} catch (e) {
  const hints = {
    '28P01': 'password errata: controlla DATABASE_URL nel file .env',
    ECONNREFUSED: 'PostgreSQL non raggiungibile: verifica che il servizio sia avviato e host/porta in DATABASE_URL',
    '3D000': 'database inesistente e impossibile da creare: crealo a mano o usa un utente con permesso CREATEDB',
  };
  console.error(`\n  ✖ Impossibile collegarsi al database (${config.dataDriver}): ${hints[e.code] ?? e.message}\n`);
  process.exit(1);
}
const where = db.kind === 'memory'
  ? path.relative(config.root, config.memoryFile)
  : db.kind === 'postgres' ? new URL(config.databaseUrl).host + new URL(config.databaseUrl).pathname : '';
app.listen(config.port, () => {
  console.log(`\n  ⚖  Santaniello CRM  →  http://localhost:${config.port}`);
  console.log(`     dati: ${db.kind}${where ? ` (${where})` : ''}\n`);
});
