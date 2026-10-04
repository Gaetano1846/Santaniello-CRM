# Santaniello CRM — Base44 dev notes

## Stack
Node.js 22 + Express 5 (API on port 4310) + React 19 / Vite 6 (dev server on 5173).
Single repo; `npm run dev` uses `concurrently` to start both processes.

## Running in Base44
`docker compose -f docker-compose.base44.yml up -d` starts PostgreSQL and the app
(both API + Vite in one container, Vite mapped to host port 3000). The app startup
command also runs `node server/db/seed.js` before the dev server — it is idempotent
(skips if data already exists) so demo data is populated on first boot only.

- PostgreSQL runs as a compose service with generated credentials (not a secret).
- The app auto-creates the database and applies `server/db/postgres/schema.sql` on
  every startup via `getDb()`.
- The `seed` service runs after the app is healthy and is idempotent (skips if data
  exists). Demo login: `g.santaniello@studio.it` / `santaniello`.
- `vite.config.js` sets `host: true` + `allowedHosts: true` so the dev server is
  reachable through the Docker port mapping and the preview proxy.

## Data drivers
`DATA_DRIVER` selects the backend: `postgres` (default here), `firestore` (needs
Firebase service account + web API key), or `memory` (local JSON, needs `npm run seed`).
Only `postgres` is wired in the Base44 compose. Firestore/Algolia credentials are
optional and not required to boot.

## Verification
- `curl localhost:3000/api/health` → `{"ok":true,"driver":"postgres",...}`
- The Vite-served frontend is at `localhost:3000` (the cloned source, not a build).
- After seed completes, log in with the demo account above.
