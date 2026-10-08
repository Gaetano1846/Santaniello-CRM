import fs from 'node:fs';

/**
 * Carica .env per il server di sviluppo (npm run dev:server, con --import).
 * Non si usa --env-file-if-exists insieme a --watch-path: per sorvegliare .env Node
 * osserva in modo ricorsivo l'intera cartella del progetto, compresa data/uploads,
 * e il server si riavvierebbe a ogni file caricato o eliminato.
 */
if (fs.existsSync('.env')) process.loadEnvFile('.env');
