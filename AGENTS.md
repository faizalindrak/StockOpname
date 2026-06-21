# Repository Guide

## Project shape
- This is a two-package JavaScript app: Vite/React frontend at the repo root and a separate Hono/PostgreSQL API package under `server/`; install both with `npm install` and `npm --prefix server install`.
- Frontend entrypoints: `src/main.jsx` wraps `src/App.jsx` in `AuthProvider`; app routes and guards live in `src/App.jsx`.
- Backend entrypoint: `server/src/index.js`; it mounts public `/auth`, authenticated `/rest/*` and `/rpc/*`, `/health`, plus WebSocket realtime at `/realtime`.
- Despite filenames/imports, there is no Supabase JS client: `src/lib/supabase.js` is a compatibility shim over `src/lib/db/index.js`/`compat.js`, backed by the custom Hono/PostgreSQL API.

## Commands
- Run both dev servers: `npm run dev` (Vite on `5173`, API on `3000`, proxying `/api`, `/auth`, `/rest`, `/rpc`, `/realtime`).
- Frontend only: `npm run dev:client`; server only: `npm run dev:server`.
- Frontend build: `npm run build`; preview: `npm run preview`.
- Frontend tests: `npm test`; focused test: `npx vitest run src/test/<file>.test.js` or `.jsx`.
- Server tests: `npm run test:server` from root, or `npm --prefix server test`; focused server test: `node --test server/test/<file>.test.js`.

## Environment and database
- Frontend API base is `VITE_API_URL` (default `http://localhost:3000`) in `.env.local`; `vite.config.js` also uses it for dev proxy targets.
- Server env lives in `server/.env`: `DATABASE_URL` is required by `server/src/db.js`; `JWT_SECRET` is required in production but falls back to `dev-secret-change-me` outside production; `PORT` defaults to `3000`; `CORS_ORIGIN` defaults to `http://localhost:5173`.
- Apply database SQL manually and in order: `database/schema_postgres.sql` (standalone schema) or `database/migration_up.sql`, then `database/recurring_sessions_migration.sql` if scheduled/recurring sessions are needed, then `server/db/password_column_migration.sql` only for existing DBs missing `profiles.password_hash`.
- Realtime depends on SQL triggers/functions that `pg_notify(<table>_changes, ...)`; `server/src/realtime.js` only `LISTEN`s to its curated table list, so add new realtime tables there too.
- Recurring sessions require extra cron setup documented in `database/recurring_sessions_cron_setup.md`; migrations alone do not schedule jobs.

## Tests and verification notes
- Vitest excludes `server/**`; use the Node test runner for backend tests.
- Frontend tests run in jsdom with `src/test/setup.js`, which adds jest-dom matchers and mocks `matchMedia` plus `IntersectionObserver`.
- Server unit tests are mostly dependency-light, but modules importing `server/src/db.js` need `DATABASE_URL`; some tests set a dummy localhost URL themselves.
- No lint or typecheck script is defined in either package; do not invent one as a required verification step.

## Conventions and gotchas
- Path alias `@/*` maps to `src/*` in both `vite.config.js` and `jsconfig.json`; shadcn config is JavaScript (`tsx: false`) with aliases in `components.json`.
- The migration direction is Supabase -> Hono/PostgreSQL: do not add `@supabase/supabase-js` or new Supabase service dependencies; route data/auth/realtime through `src/lib/db/*` and `server/src/*`.
- Keep Supabase-shaped frontend query semantics working while legacy callers remain: `.from().select/insert/update/delete`, `.rpc()`, `.channel()`, and `auth.*` are implemented in `src/lib/db/compat.js` over the Hono REST/auth/realtime endpoints.
- When replacing legacy `supabase` imports, prefer `src/lib/db/index.js` or service modules under `src/lib/services/`; update `src/lib/db/http.js`, `server/src/queryBuilder.js`, and `server/src/routes/rest.js` together if query semantics change.
- The API maps profile roles for compatibility (`server/src/roles.js`/`routes/rest.js`); check role mapping tests before changing admin/counter/user behavior.
- REST writes are authorization-gated in `server/src/authorize.js`; RPC calls through `/rest/rpc/:fn` and `/rpc/*` are admin-only.
- `scripts/AdminDashboard.orig.jsx` is an old large backup; prefer the active files under `src/components/` and `src/components/admin/`.
