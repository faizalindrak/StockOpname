# Warehouse Cycle Count App

A warehouse cycle counting application built with React, Vite, Tailwind CSS, and Supabase.

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

| Layer      | Technology                          |
| ---------- | ----------------------------------- |
| Frontend   | React 18, React Router 7            |
| Styling    | Tailwind CSS 3, Lucide Icons        |
| Backend    | Supabase (Auth, Database, RLS, Realtime) |
| Build      | Vite 5                              |
| Testing    | Vitest, React Testing Library       |
| Deployment | Vercel                              |

## Getting Started

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/faizalindrak/CycleCountAppStark.git
   cd CycleCountAppStark
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env.local` file in the root directory:
   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

4. Run the database migrations in your Supabase SQL Editor.  
   Migration files are located in the [`database/`](./database) directory.

5. Start the development server:
   ```bash
   npm run dev
   ```

## Scripts

| Command              | Description                  |
| -------------------- | ---------------------------- |
| `npm run dev`        | Start development server     |
| `npm run build`      | Production build              |
| `npm run preview`    | Preview production build      |
| `npm test`           | Run tests                     |
| `npm run test:ui`    | Run tests with UI             |
| `npm run test:coverage` | Run tests with coverage    |

## Database

All SQL migrations, RLS policies, and database functions live in the [`database/`](./database) directory. Run them in order via the Supabase SQL Editor.

Key tables: `profiles`, `items`, `categories`, `locations`, `sessions`, `session_items`, `session_users`, `counts`.

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
    supabase.js            # Supabase client
    utils.js               # Utility functions
    deviceDetection.js     # Mobile/desktop detection
  test/                    # Unit tests
database/                  # SQL migrations and setup guides
```

## Deployment

The app is configured for Vercel deployment via `vercel.json`. Push to the main branch to trigger a deploy, or run:

```bash
npm run build
```
