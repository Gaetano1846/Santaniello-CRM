-- =====================================================================
-- Santaniello CRM — schema PostgreSQL
-- Traduzione relazionale delle collezioni Firestore dell'app originale.
-- Gli id sono testo (compatibili con gli id Firestore importati).
-- Idempotente: può essere eseguito a ogni avvio.
-- =====================================================================

CREATE TABLE IF NOT EXISTS users (
  id            text PRIMARY KEY,
  email         text,
  display_name  text,
  photo_url     text,
  uid           text,
  created_time  timestamptz,
  phone_number  text
);

-- Credenziali di accesso (sostituisce Firebase Auth)
CREATE TABLE IF NOT EXISTS auth_accounts (
  id    text PRIMARY KEY,   -- = users.id (l'account nasce prima del profilo, come in Firebase Auth)
  email text NOT NULL UNIQUE,
  hash  text NOT NULL,
  salt  text NOT NULL
);

CREATE TABLE IF NOT EXISTS clienti (
  id           text PRIMARY KEY,
  nome         text,
  partita_iva  text,
  email        text,
  telefono     bigint,
  indirizzo    text,
  caso_aperto  boolean,
  categoria    text,
  note         text
);

-- Clienti/{id}/Contatti
CREATE TABLE IF NOT EXISTS contatti (
  id              text PRIMARY KEY,
  cliente_id      text NOT NULL REFERENCES clienti(id) ON DELETE CASCADE,
  nome            text,
  email           text,
  telefono        text,
  data_creazione  timestamptz
);

CREATE TABLE IF NOT EXISTS consulenze (
  id                   text PRIMARY KEY,
  cliente_id           text REFERENCES clienti(id) ON DELETE SET NULL,
  titolo               text,
  descrizione          text,
  avvocato_principale  text REFERENCES users(id) ON DELETE SET NULL,
  data_creazione       timestamptz,
  data_inizio          text,               -- "dd/MM/yyyy" come nell'originale
  avvocati_supporto    text[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS casi (
  id                   text PRIMARY KEY,
  titolo               text,
  cliente_id           text REFERENCES clienti(id) ON DELETE SET NULL,
  area_pratica         text,
  data_creazione       timestamptz,
  avvocato_principale  text REFERENCES users(id) ON DELETE SET NULL,
  avvovati_supporto    text[] NOT NULL DEFAULT '{}',   -- refuso del campo originale mantenuto
  data_inizio          text,
  scadenza             text,
  descrizione          text
);

-- Casi/{id}/Contatti_Caso
CREATE TABLE IF NOT EXISTS contatti_caso (
  id              text PRIMARY KEY,
  caso_id         text NOT NULL REFERENCES casi(id) ON DELETE CASCADE,
  nome            text,
  email           text,
  telefono        text,
  data_creazione  timestamptz
);

CREATE TABLE IF NOT EXISTS folder (
  id             text PRIMARY KEY,
  titolo         text,
  data_creazione timestamptz,
  cliente_id     text REFERENCES clienti(id) ON DELETE SET NULL,
  consulenza_id  text REFERENCES consulenze(id) ON DELETE SET NULL,
  caso_id        text REFERENCES casi(id) ON DELETE SET NULL,
  parent_folder  text REFERENCES folder(id) ON DELETE CASCADE,
  array_parents  text[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS files (
  id                text PRIMARY KEY,
  nome              text,
  data_caricamento  timestamptz,
  file              text,                 -- URL di download
  folder_ref        text REFERENCES folder(id) ON DELETE CASCADE
);

-- Files/{id}/VersioneFile (presente nell'originale solo per le eliminazioni)
CREATE TABLE IF NOT EXISTS versione_file (
  id       text PRIMARY KEY,
  file_id  text NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  data     jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS activity (
  id             text PRIMARY KEY,
  titolo         text,
  data           timestamptz,
  utente         text REFERENCES users(id) ON DELETE SET NULL,
  cliente_id     text REFERENCES clienti(id) ON DELETE SET NULL,
  consulenza_id  text REFERENCES consulenze(id) ON DELETE SET NULL,
  caso_id        text REFERENCES casi(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS promemoria (
  id               text PRIMARY KEY,
  data_creazione   timestamptz,
  titolo           text,
  descrizione      text,
  data_promemoria  text,                  -- "dd/MM/yyyy"
  utente           text REFERENCES users(id) ON DELETE SET NULL,
  ora_promemoria   text,                  -- "HH:mm"
  consulenza_ref   text REFERENCES consulenze(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS appuntamenti (
  id                 text PRIMARY KEY,
  titolo             text,
  data_creazione     timestamptz,
  data_appuntamento  text,                -- "dd/MM/yyyy"
  ora_appuntamento   text,                -- "HH:mm"
  luogo              text,
  utente             text REFERENCES users(id) ON DELETE SET NULL,
  consulenza_ref     text REFERENCES consulenze(id) ON DELETE SET NULL
);

-- Indici per le query usate dall'app (equivalenti a firestore.indexes.json)
CREATE INDEX IF NOT EXISTS contatti_cliente_idx      ON contatti (cliente_id);
CREATE INDEX IF NOT EXISTS contatti_caso_caso_idx    ON contatti_caso (caso_id);
CREATE INDEX IF NOT EXISTS consulenze_cliente_idx    ON consulenze (cliente_id);
CREATE INDEX IF NOT EXISTS consulenze_creazione_idx  ON consulenze (data_creazione DESC);
CREATE INDEX IF NOT EXISTS casi_cliente_idx          ON casi (cliente_id);
CREATE INDEX IF NOT EXISTS folder_parent_idx         ON folder (parent_folder, data_creazione DESC);
CREATE INDEX IF NOT EXISTS folder_cliente_idx        ON folder (cliente_id);
CREATE INDEX IF NOT EXISTS folder_consulenza_idx     ON folder (consulenza_id);
CREATE INDEX IF NOT EXISTS folder_caso_idx           ON folder (caso_id);
CREATE INDEX IF NOT EXISTS folder_parents_gin        ON folder USING gin (array_parents);
CREATE INDEX IF NOT EXISTS files_folder_idx          ON files (folder_ref, data_caricamento DESC);
CREATE INDEX IF NOT EXISTS activity_data_idx         ON activity (data DESC);
CREATE INDEX IF NOT EXISTS activity_cliente_idx      ON activity (cliente_id, utente);
CREATE INDEX IF NOT EXISTS activity_consulenza_idx   ON activity (consulenza_id, utente);
CREATE INDEX IF NOT EXISTS activity_caso_idx         ON activity (caso_id);
CREATE INDEX IF NOT EXISTS promemoria_utente_idx     ON promemoria (utente, data_creazione DESC);
CREATE INDEX IF NOT EXISTS promemoria_consulenza_idx ON promemoria (consulenza_ref);
CREATE INDEX IF NOT EXISTS appuntamenti_utente_idx   ON appuntamenti (utente, data_creazione DESC);
CREATE INDEX IF NOT EXISTS appuntamenti_cons_idx     ON appuntamenti (consulenza_ref);
