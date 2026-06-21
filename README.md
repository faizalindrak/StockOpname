# Warehouse Cycle Count App

A warehouse cycle counting application built with React, Vite, Tailwind CSS, and a generic PostgreSQL backend (Hono + WebSocket realtime).

## Features

- **Role-Based Authentication** — Admin and Counter roles with protected routes
- **Session Management** — Create one-time, scheduled, and recurring cycle count sessions
- **Recurring Sessions** — Daily, weekly, and monthly auto-generated sessions with time windows
- **Real-Time Counting** — Barcode scanning, location tracking, and countdown timers
- **Kanban Board** — Drag-and-drop workflow for managing count items
- **Follow-Up Tracking** — Flag and bulk-manage items that need re-counting
- **Report Status** — Raw material reporting with real-time updates
- **History** — View past counting sessions and results
- **Export** — Download count data as Excel/CSV
- **Responsive Design** — Mobile-friendly interface with device detection

## Tech Stack

| Layer        | Technology                            |
| ------------ | ------------------------------------- |
| Frontend     | React 18, React Router 7              |
| Styling      | Tailwind CSS 3, Lucide Icons          |
| Backend API  | Hono on Node.js                       |
| Database     | PostgreSQL (any provider)             |
| Realtime     | WebSocket + `LISTEN`/`NOTIFY`         |
| Auth         | JWT (email + password, bcrypt)        |
| Build        | Vite 5                                |
| Testing      | Vitest, React Testing Library         |
| Deployment   | Vercel (frontend) + any Node host (API) |

## Getting Started

### Prerequisites

- Node.js 18+
- A PostgreSQL 14+ instance (local, Neon, Supabase, RDS, etc.)

### Setup

1. Clone the repository and install dependencies for both packages:
   ```bash
   git clone https://github.com/faizalindrak/CycleCountAppStark.git
   cd CycleCountAppStark
   npm install
   npm --prefix server install
   ```

2. Create a `.env` file inside `server/`:
   ```
   DATABASE_URL=postgresql://user:password@host:5432/stockopname
   JWT_SECRET=replace-with-a-long-random-secret
   PORT=3000
   CORS_ORIGIN=http://localhost:5173
   ```

3. Create a `.env.local` file in the project root for the frontend:
   ```
   VITE_API_URL=http://localhost:3000
   ```

4. Run the SQL migrations against your database (in order):
   - `database/schema_postgres.sql` (full standalone schema) **or** `database/migration_up.sql`
   - `database/recurring_sessions_migration.sql` (if you need recurring/scheduled sessions)
   - `server/db/password_column_migration.sql` (only when upgrading an existing DB without `password_hash`)

5. Start both the API server and Vite dev server in one command:
   ```bash
   npm run dev
   ```
   The Vite dev server proxies `/auth`, `/rest`, `/rpc`, and `/realtime` to the API on `http://localhost:3000`.

## Scripts

| Command                  | Description                                          |
| ------------------------ | ---------------------------------------------------- |
| `npm run dev`            | Start API + Vite dev servers (concurrently)          |
| `npm run dev:client`     | Vite only                                            |
| `npm run dev:server`     | API only (uses `node --watch`)                       |
| `npm run build`          | Production build of the frontend                     |
| `npm run preview`        | Preview production build                             |
| `npm test`               | Run tests                                            |
| `npm run test:ui`        | Run tests with UI                                    |
| `npm run test:coverage`  | Run tests with coverage                              |

## Database

All SQL migrations, RLS-style policies, and database functions live in the [`database/`](./database) directory.

Key tables: `profiles`, `items`, `categories`, `locations`, `sessions`, `session_items`, `session_users`, `counts`, `item_groups`, `item_group_items`, `report_status_raw_mat`.

### Realtime

The Hono server subscribes to PostgreSQL `LISTEN`/`NOTIFY` channels. The trigger function `notify_table_change()` (in `database/realtime_notify_triggers.sql`) emits a notification on every insert/update/delete, and the server forwards those events to subscribed WebSocket clients.

### Recurring Sessions

For recurring/scheduled sessions, additional setup is needed:

- Run `database/recurring_sessions_migration.sql`
- Set up cron jobs — see `database/recurring_sessions_cron_setup.md`

## Project Structure

```
src/
  App.jsx                  # Routes and auth guards
  main.jsx                 # Entry point
  index.css                # Global styles
  components/
    AdminDashboard.jsx     # Admin panel (items, users, sessions, categories)
    SessionSelection.jsx   # Session picker with countdown timers
    ItemsList.jsx          # Counting interface
    KanbanBoard.jsx        # Drag-and-drop item workflow
    ReportStatus.jsx       # Raw material reporting
    HistoryPage.jsx        # Past session history
    LoginForm.jsx          # Authentication
    ...
  contexts/
    AuthContext.jsx         # Auth state management
  lib/
    api.js                  # Hono HTTP + WebSocket client (PostgREST-compatible)
    supabase.js             # Backwards-compat re-export of ./api.js
    utils.js                # Utility functions
    deviceDetection.js      # Mobile/desktop detection
  test/                    # Unit tests
server/
  src/
    index.js               # Hono app entry (HTTP + WebSocket)
    db.js                  # pg pool + dedicated LISTEN client
    auth.js                # JWT + bcrypt + auth middleware
    queryBuilder.js        # PostgREST-style select -> SQL
    realtime.js            # WebSocket pub/sub + LISTEN/NOTIFY bridge
    routes/
      auth.js              # /auth/signup, /auth/signin, /auth/signout, /auth/me
      rest.js              # /rest/:table, /rest/rpc/:fn
database/                  # SQL migrations and setup guides
```

## Deployment

The frontend is configured for Vercel deployment via `vercel.json`. The API server (`server/`) can be deployed to any Node host (Render, Fly, Railway, a VM, etc.) and pointed at your PostgreSQL instance.
