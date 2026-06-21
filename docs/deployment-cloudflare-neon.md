# Deployment: Cloudflare Pages + Cloudflare Workers + Neon PostgreSQL

This guide deploys the React frontend to Cloudflare Pages, the Hono API to Cloudflare Workers, and PostgreSQL to Neon.

> Current status: the frontend can deploy to Cloudflare Pages, and the API includes a Cloudflare Worker entrypoint at `server/src/worker.js` using Neon serverless PostgreSQL plus a Durable Object for realtime fanout.

## 1. Architecture

```text
Browser
  |
  | https://<frontend>.pages.dev
  v
Cloudflare Pages (Vite React static app)
  |
  | VITE_API_URL=https://<api-worker>.<account>.workers.dev
  v
Cloudflare Worker (Hono API)
  |
  | DATABASE_URL / Hyperdrive binding
  v
Neon PostgreSQL
```

Runtime paths after deployment:

- Frontend assets are built by Vite into `dist/` and served by Cloudflare Pages.
- Frontend API calls use `VITE_API_URL` from Pages environment variables.
- Hono routes serve `/health`, `/auth/*`, `/rest/*`, `/rest/rpc/*`, and `/rpc/*`.
- PostgreSQL schema and functions live in Neon.
- Realtime on Workers uses a Durable Object WebSocket endpoint at `/realtime`; REST writes publish changes to the Durable Object after successful database writes.

## 2. Prepare Neon PostgreSQL

1. Create a Neon project at <https://neon.tech>.
2. Open the Neon SQL Editor, or connect with `psql` using the connection string from Neon.
3. Apply database SQL in this order:
   - `database/schema_postgres.sql` for a fresh database, or `database/migration_up.sql` for an incremental setup.
   - `database/recurring_sessions_migration.sql` if scheduled/recurring sessions are needed.
   - `database/realtime_notify_triggers.sql` if using the current PostgreSQL `NOTIFY` trigger model outside Workers, or as a base for a future realtime service.
   - `server/db/password_column_migration.sql` only for an existing database missing `profiles.password_hash`.
4. Save the Neon connection string. It should look like:

```text
postgresql://<user>:<password>@<host>/<database>?sslmode=require
```

The Worker backend uses `@neondatabase/serverless` through `server/src/workerDb.js`. Keep the Neon connection string as a Worker secret named `DATABASE_URL`; the helper opens and closes a Neon `Client` per query/transaction so the Worker does not keep a global PostgreSQL connection.

## 3. Hono API Worker entrypoint

The Worker entrypoint is `server/src/worker.js`. It creates the shared Hono app from `server/src/app.js`, injects Worker `env` bindings, uses `createWorkerDb(env)` for Neon, and routes `/realtime` to the Durable Object binding named `REALTIME`.

The Node development entrypoint remains `server/src/index.js`; it injects the Node `pg` adapter and attaches the existing Node WebSocket/`LISTEN` bridge for local or Node-hosted deployments.

Key Worker files:

- `server/src/worker.js`: Worker `fetch` handler and `/realtime` Durable Object routing.
- `server/src/app.js`: shared Hono app factory for Node and Worker runtimes.
- `server/src/workerDb.js`: Neon serverless `query()` and `withTransaction()` adapter.
- `server/src/realtimeDo.js`: Durable Object WebSocket fanout for frontend realtime subscriptions.
- `server/src/realtimePublisher.js`: REST write publish abstraction.

The Worker bundle does not use the Node-only `server/src/realtime.js` `ws`/`LISTEN` bridge. On Workers, realtime events are published explicitly by successful REST writes and fanned out through the `REALTIME` Durable Object.

## 4. Worker configuration

Use `server/wrangler.toml` for the Worker and Durable Object binding:

```toml
name = "stockopname-api"
main = "src/worker.js"
compatibility_date = "2026-06-21"

[vars]
CORS_ORIGIN = "https://<frontend>.pages.dev"

[[durable_objects.bindings]]
name = "REALTIME"
class_name = "RealtimeDurableObject"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["RealtimeDurableObject"]
```

Set secrets from `server/`:

```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put DATABASE_URL
```

For local Worker development, create `server/.dev.vars` and do not commit it:

```text
DATABASE_URL=postgresql://<user>:<password>@<neon-host>/<database>?sslmode=require
JWT_SECRET=dev-secret-change-me
CORS_ORIGIN=http://localhost:5173
```

Deploy the Worker from `server/`:

```bash
npm --prefix server install
npx wrangler dev
npx wrangler deploy
```

After deployment, test:

```bash
curl https://<api-worker>.<account>.workers.dev/health
```

## 5. Deploy the frontend to Cloudflare Pages

Cloudflare Pages settings for this Vite React app:

| Setting | Value |
| --- | --- |
| Framework preset | React (Vite), or no preset with manual settings |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | repository root |
| Production branch | your production branch, usually `main` |

Set Pages environment variables:

| Variable | Production value |
| --- | --- |
| `VITE_API_URL` | `https://<api-worker>.<account>.workers.dev` or your API custom domain |

Dashboard flow:

1. Go to Cloudflare Dashboard -> Workers & Pages -> Create application -> Pages.
2. Import the repository.
3. Set the build command to `npm run build` and output directory to `dist`.
4. Add `VITE_API_URL` in Settings -> Environment variables.
5. Deploy.

CLI deploy alternative:

```bash
npm install
npm run build
npx wrangler pages deploy dist --project-name stockopname-frontend
```

## 6. CORS and custom domains

Use stable domains before final production testing:

- Frontend: `https://app.example.com` -> Cloudflare Pages custom domain.
- API: `https://api.example.com` -> Worker route/custom domain.

Set `CORS_ORIGIN` on the Worker to the exact frontend origin:

```text
https://app.example.com
```

Set `VITE_API_URL` on Pages to the exact API origin:

```text
https://api.example.com
```

If either domain changes, update both variables and redeploy Pages so Vite embeds the new `VITE_API_URL` at build time.

## 7. Verification checklist

Run before production cutover:

1. Neon schema exists:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;
```

2. Worker health endpoint responds:

```bash
curl https://api.example.com/health
```

3. Worker dry-run succeeds from `server/`:

```bash
./node_modules/.bin/wrangler deploy --dry-run
```

4. Frontend build succeeds:

```bash
npm run build
```

5. Frontend can reach the API:

```bash
curl -i https://api.example.com/auth/me
```

Expected unauthenticated result is an auth error, not a DNS/CORS/network failure.

6. Login flow works with a known user.
7. Admin screens load data from `/rest/*`.
8. Counter screens can save counts.
9. Realtime check: open the app in two browser sessions, subscribe to a table-backed screen, make a REST write in one session, and verify the other session receives the update over `/realtime`.

## 8. Rollback plan

- Keep the previous frontend deployment in Cloudflare Pages; Pages supports rollback to an earlier deployment.
- Keep the previous Worker deployment available; Workers deployments can be rolled back from the Cloudflare dashboard.
- Neon supports backups/restore depending on plan and retention. Create a backup/branch before running migrations against production.
- If a Worker deployment has issues, temporarily point `VITE_API_URL` back to a known-good previous API deployment or a Node-hosted Hono API while rolling back the Worker.

## 9. Production readiness checklist

- Set Worker secrets with `wrangler secret put DATABASE_URL` and `wrangler secret put JWT_SECRET`.
- Set `CORS_ORIGIN` in `server/wrangler.toml` or the Cloudflare dashboard to the final Pages URL.
- Run `npm --prefix server test` before backend deploys.
- Run `./node_modules/.bin/wrangler deploy --dry-run` from `server/` before production deploys.
- Run `npm run build` and configure Cloudflare Pages with `VITE_API_URL=https://<api-worker>.<account>.workers.dev`.
