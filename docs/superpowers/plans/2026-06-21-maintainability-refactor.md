# StockOpname Maintainability Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate Supabase-compat debt, decompose monolith React files, and establish explicit API/policy boundaries — with zero user-visible behavior change.

**Architecture:** Incremental strangler pattern. (1) Harden the server policy layer and shared helpers first. (2) Extract domain services from `api.js` while keeping the compat client working. (3) Split `AdminDashboard.jsx` and `ItemsList.jsx` along existing `React.memo` seams. (4) Rename imports from `supabase` → `db` and delete the shim only after all callers use services or the thin client.

**Tech Stack:** React 18, Vite 5, Vitest 4, Hono 4, `pg` 8, Node 18+, PostgreSQL 14+, JWT/bcrypt auth, WebSocket + `LISTEN`/`NOTIFY` realtime.

## Global Constraints

- Node.js 18+; PostgreSQL 14+; no `@supabase/supabase-js` dependency.
- Preserve all existing routes: `/auth/*`, `/rest/*`, `/rest/rpc/*`, `/rpc/*`, `/realtime`, `/health`.
- Frontend env: `VITE_API_URL` (default `http://localhost:3000`); server env: `DATABASE_URL`, `JWT_SECRET` (required in production), `CORS_ORIGIN`, `PORT`.
- Tests must pass: `npm test -- --run` (frontend) and `npm run test:server` (server).
- No user-visible behavior changes; no schema migrations unless required for role enum unification (prefer UI rename over enum change).
- Commit after each task; one task = one PR-sized unit.

**Scope note:** This plan has 5 phases across server + frontend. Phases 1–2 and Phase 3 can run in parallel by different engineers. Phase 4 depends on Phase 3 patterns. Phase 5 depends on Phase 2.

---

## File Structure (Target)

```
server/src/
  policy.js              # declarative table/method rules (replaces Set spaghetti)
  realtimeFilters.js     # exported recordMatchesRealtimeFilter
  routes/
    rest.js              # uses policy.js; single RPC entry
    rpc.js               # thin wrapper → handleRpc (admin guard in handleRpc only)

src/lib/
  db/
    client.js            # thin HTTP + WS transport (rename from api.js internals)
    compat.js            # temporary SupabaseCompat (deleted in Task 20)
  services/
    profiles.js
    categories.js
    locations.js
    sessions.js
    items.js
    reports.js
  supabase.js            # shim → re-exports compat + services (deleted Task 20)

src/components/
  AdminDashboard.jsx     # ~400 lines shell only
  admin/
    SessionsManager.jsx
    ItemGroupsManager.jsx
    ItemsManager.jsx
    UsersManager.jsx
    CategoriesManager.jsx
    modals/              # editors + assignment modals
  items/
    ItemsList.jsx        # ~300 lines shell
    useSessionCounts.js
    CountEntryPanel.jsx
    ItemsListToolbar.jsx

src/contexts/
  AuthContext.jsx        # single resolveSession() path, no debug logs
```

---

## Phase 1 — Server Canonical Layer

### Task 1: Declarative policy module

**Files:**
- Create: `server/src/policy.js`
- Create: `server/test/policy.test.js`
- Modify: `server/src/authorize.js` (delegate to policy.js)
- Modify: `server/src/routes/rest.js` (import from policy.js)

**Interfaces:**
- Consumes: JWT payload `{ sub: string, role: 'admin' | 'user', email: string }`
- Produces:
  - `scopeRead(table: string, user, filters: Filter[]): { filters, extraClause, extraParams }`
  - `authorizeWrite(table: string, user, ctx: { method, body, filters }): Promise<string | null>` — returns error message or null
  - `canCallRpc(user): boolean`

- [ ] **Step 1: Write the failing test**

```js
// server/test/policy.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scopeRead, canCallRpc } from "../src/policy.js";

const counter = { sub: "user-1", role: "user" };
const admin = { sub: "admin-1", role: "admin" };

describe("scopeRead", () => {
  it("scopes profiles to self for non-admin", () => {
    const { filters } = scopeRead("profiles", counter, []);
    assert.equal(filters.length, 1);
    assert.equal(filters[0].column, "id");
    assert.equal(filters[0].value, "user-1");
  });

  it("adds session assignment clause for non-admin sessions", () => {
    const { extraClause, extraParams } = scopeRead("sessions", counter, []);
    assert.match(extraClause, /session_users/);
    assert.deepEqual(extraParams, ["user-1"]);
  });
});

describe("canCallRpc", () => {
  it("allows admin only", () => {
    assert.equal(canCallRpc(admin), true);
    assert.equal(canCallRpc(counter), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:server`
Expected: FAIL — `policy.js` not found

- [ ] **Step 3: Implement policy.js**

```js
// server/src/policy.js
import { quoteIdent } from "./queryBuilder.js";

const ADMIN = "admin";

/** @typedef {{ column: string; op: string; value: any }} Filter */

const READ_SCOPE = {
  profiles: (user) => ({
    filters: [{ column: "id", op: "=", value: user.sub }],
    extraClause: null,
    extraParams: [],
  }),
  sessions: (user) => ({
    filters: [],
    extraClause: `${quoteIdent("id")} IN (SELECT session_id FROM session_users WHERE user_id = $1)`,
    extraParams: [user.sub],
  }),
  session_users: (user) => ({
    filters: [{ column: "user_id", op: "=", value: user.sub }],
    extraClause: null,
    extraParams: [],
  }),
};

const POST_ADMIN_ONLY = new Set([
  "categories", "locations", "items", "item_groups", "item_group_items",
  "sessions", "session_users", "session_items",
]);

const PATCH_DELETE_ADMIN_ONLY = new Set([
  "profiles", "sessions", "session_users", "session_items",
  "categories", "locations", "items", "item_groups", "item_group_items",
]);

export function isAdmin(user) {
  return user?.role === ADMIN;
}

export function canCallRpc(user) {
  return isAdmin(user);
}

export function scopeRead(table, user, filters) {
  if (isAdmin(user)) return { filters, extraClause: null, extraParams: [] };
  const fn = READ_SCOPE[table];
  if (!fn) return { filters, extraClause: null, extraParams: [] };
  const scoped = fn(user);
  return { filters: [...filters, ...scoped.filters], extraClause: scoped.extraClause, extraParams: scoped.extraParams };
}

export async function authorizeWrite(table, user, { method, body, filters }, { query }) {
  if (isAdmin(user)) return null;

  if (method === "POST" && POST_ADMIN_ONLY.has(table)) {
    return "Only administrators can create records in this table";
  }

  if ((method === "PATCH" || method === "DELETE") && PATCH_DELETE_ADMIN_ONLY.has(table)) {
    if (table === "profiles") {
      const onlySelf = filters.length === 1
        && filters[0].column === "id"
        && filters[0].op === "="
        && String(filters[0].value) === String(user.sub);
      return onlySelf ? null : "You can only update your own profile";
    }
    return "Only administrators can modify this table";
  }

  if (method === "POST" && table === "counts") {
    const rows = Array.isArray(body) ? body : [body];
    for (const row of rows) {
      if (!row?.session_id) return "session_id is required";
      const assigned = await query(
        "select 1 from session_users where session_id = $1 and user_id = $2 limit 1",
        [row.session_id, user.sub]
      );
      if (!assigned.rows.length) return "You are not assigned to this session";
    }
  }

  return null;
}
```

- [ ] **Step 4: Refactor authorize.js to re-export policy**

```js
// server/src/authorize.js
export { scopeRead as scopeReadFilters, authorizeWrite, canCallRpc } from "./policy.js";
```

Update `rest.js` counts PATCH/DELETE authorization to pass `{ query }` into `authorizeWrite` (move counts lookup logic into `policy.js` in a follow-up commit within this task).

- [ ] **Step 5: Run tests**

Run: `npm run test:server`
Expected: PASS (6+ tests)

- [ ] **Step 6: Commit**

```bash
git add server/src/policy.js server/src/authorize.js server/test/policy.test.js server/src/routes/rest.js
git commit -m "refactor(server): replace authorize Sets with declarative policy module"
```

---

### Task 2: Export realtime filter helper (delete duplication)

**Files:**
- Create: `server/src/realtimeFilters.js`
- Modify: `server/src/realtime.js`
- Modify: `server/test/realtime.test.js`

**Interfaces:**
- Produces: `recordMatchesRealtimeFilter(filterStr: string, record: object): boolean`

- [ ] **Step 1: Write failing test importing from module**

```js
// server/test/realtime.test.js
import { recordMatchesRealtimeFilter } from "../src/realtimeFilters.js";
// ... existing assertions unchanged
```

- [ ] **Step 2: Run test — FAIL** (module missing)

- [ ] **Step 3: Create realtimeFilters.js**

```js
// server/src/realtimeFilters.js
export function recordMatchesRealtimeFilter(filterStr, record) {
  const supabaseEq = filterStr.match(/^([^=]+)=eq\.(.+)$/);
  if (supabaseEq) {
    const [, col, val] = supabaseEq;
    return String(record[col]) === val;
  }
  const [col, op, ...rest] = filterStr.split(".");
  const val = rest.join(".");
  if (op === "eq") return String(record[col]) === val;
  if (op === "neq") return String(record[col]) !== val;
  return true;
}
```

```js
// server/src/realtime.js — add at top
import { recordMatchesRealtimeFilter } from "./realtimeFilters.js";
// delete local duplicate function
```

- [ ] **Step 4: Run `npm run test:server` — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(server): extract shared realtime filter matcher"
```

---

### Task 3: Collapse duplicate RPC admin guard

**Files:**
- Modify: `server/src/routes/rest.js`
- Modify: `server/src/routes/rpc.js`

**Interfaces:**
- `handleRpc(c)` — admin check moved inside; returns 403 if `!canCallRpc(user)`

- [ ] **Step 1: Write failing test**

```js
// server/test/rpcAuth.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canCallRpc } from "../src/policy.js";

describe("RPC auth", () => {
  it("counter cannot call rpc", () => {
    assert.equal(canCallRpc({ role: "user" }), false);
  });
});
```

- [ ] **Step 2: Run — PASS already if Task 1 done; add integration note**

- [ ] **Step 3: Move guard into handleRpc**

```js
// server/src/routes/rest.js — inside handleRpc, first lines:
export async function handleRpc(c) {
  const user = c.get("user");
  if (!canCallRpc(user)) {
    return c.json({ error: "Only administrators can call RPC functions" }, 403);
  }
  // ... existing RPC logic
}
```

```js
// server/src/routes/rpc.js
import { Hono } from "hono";
import { handleRpc } from "./rest.js";
const router = new Hono();
router.post("/:fn", (c) => handleRpc(c));
export default router;
```

Remove duplicate admin checks from `rest.js` `POST /rpc/:fn` route handler (now only `handleRpc`).

- [ ] **Step 4: Run `npm run test:server` — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(server): centralize RPC admin guard in handleRpc"
```

---

## Phase 2 — Client Services Layer

### Task 4: Create HTTP transport module

**Files:**
- Create: `src/lib/db/http.js`
- Modify: `src/lib/api.js` (import http from `./db/http.js`)

**Interfaces:**
- Produces:
  - `getToken(): string | null`
  - `setToken(t: string | null): void`
  - `http(path: string, opts?: { method?, body?, query?, headers? }): Promise<any>`

- [ ] **Step 1: Write failing test**

```js
// src/test/httpClient.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getToken, setToken } from '../lib/db/http.js';

describe('token storage', () => {
  beforeEach(() => localStorage.clear());
  it('round-trips token', () => {
    setToken('abc');
    expect(getToken()).toBe('abc');
    setToken(null);
    expect(getToken()).toBeNull();
  });
});
```

- [ ] **Step 2: Run `npm test -- --run src/test/httpClient.test.js` — FAIL**

- [ ] **Step 3: Create http.js** (extract lines 5–44 from `api.js` verbatim into `src/lib/db/http.js`)

- [ ] **Step 4: Update api.js**

```js
import { http, getToken, setToken } from "./db/http.js";
export { getToken, setToken };
```

- [ ] **Step 5: Run full test suite — PASS**

- [ ] **Step 6: Commit**

```bash
git commit -m "refactor(client): extract HTTP transport to src/lib/db/http.js"
```

---

### Task 5: Extract profile and category services

**Files:**
- Create: `src/lib/services/profiles.js`
- Create: `src/lib/services/categories.js`
- Modify: `src/lib/api.js` (re-export from services for backwards compat)
- Test: `src/test/services.test.js`

**Interfaces:**
- Produces:
  - `getCurrentUserProfile(): Promise<Profile | null>`
  - `checkCategoryUsage(categoryId: string): Promise<CategoryUsageResult>`

- [ ] **Step 1: Write failing test**

```js
// src/test/services.test.js
import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/db/http.js', () => ({
  http: vi.fn(),
  getToken: () => 'tok',
  setToken: vi.fn(),
}));

import { http } from '../lib/db/http.js';
import { getCurrentUserProfile } from '../lib/services/profiles.js';

describe('getCurrentUserProfile', () => {
  it('returns null when /auth/me has no user', async () => {
    http.mockResolvedValueOnce({ data: { user: null } });
    const result = await getCurrentUserProfile();
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test — FAIL**

- [ ] **Step 3: Move helpers** (cut `getCurrentUserProfile` and `checkCategoryUsage` from `api.js` into service files; services import `http` + compat query builder or direct REST paths)

```js
// src/lib/services/profiles.js
import { http } from "../db/http.js";
import { from } from "../db/compat.js"; // Task 6; until then import supabase compat inline

export async function getCurrentUserProfile() {
  const res = await http("/auth/me");
  const user = res.data?.user;
  if (!user) return null;
  const { data, error } = await from("profiles").select("*").eq("id", user.id).single();
  if (error) return null;
  return data;
}
```

- [ ] **Step 4: Re-export from api.js**

```js
export { getCurrentUserProfile } from "./services/profiles.js";
export { checkCategoryUsage } from "./services/categories.js";
```

- [ ] **Step 5: Run tests — PASS**

- [ ] **Step 6: Commit**

```bash
git commit -m "refactor(client): extract profile and category services"
```

---

### Task 6: Extract remaining domain services

**Files:**
- Create: `src/lib/services/locations.js`
- Create: `src/lib/services/reports.js`
- Create: `src/lib/services/sessions.js`
- Modify: `src/lib/api.js`

Move these functions from `api.js`:
- `checkLocationUsage`, `softDeleteLocation`, `reactivateLocation` → `locations.js`
- `getReportStatusRecords`, `createReportStatusRecord`, `updateReportStatusRecord`, `deleteReportStatusRecord`, `getReportStatusStats` → `reports.js`

- [ ] **Step 1: Add one vitest per service file** (mock `http`, assert correct path called)

- [ ] **Step 2: Move code, re-export from api.js**

- [ ] **Step 3: Run `npm test -- --run` — PASS**

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(client): extract location and report services"
```

---

## Phase 3 — AdminDashboard Decomposition

> Extract along existing comment boundaries in `AdminDashboard.jsx`. Keep `AdminDashboard.jsx` as the route shell; move each `React.memo` block to `src/components/admin/`.

### Task 7: Extract SessionsManager

**Files:**
- Create: `src/components/admin/SessionsManager.jsx`
- Modify: `src/components/AdminDashboard.jsx` (import SessionsManager; delete lines 411–750)

**Line range:** `AdminDashboard.jsx:412-750`

- [ ] **Step 1: Create SessionsManager.jsx** — cut/paste `SessionsManager` + its imports; add:

```js
import { supabase } from '../../lib/supabase';
// ...icons used by SessionsManager only
export default React.memo(SessionsManager);
```

- [ ] **Step 2: Update AdminDashboard.jsx**

```js
import SessionsManager from './admin/SessionsManager';
```

- [ ] **Step 3: Run `npm run build` — must succeed**

- [ ] **Step 4: Manual smoke:** `npm run dev` → Admin → Sessions tab loads

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(admin): extract SessionsManager to own file"
```

---

### Task 8: Extract ItemGroupsManager

**Files:**
- Create: `src/components/admin/ItemGroupsManager.jsx`
- Modify: `src/components/AdminDashboard.jsx` (delete lines 753–940)

Same cut/paste pattern as Task 7.

- [ ] **Steps 1–5:** extract → import → build → smoke → commit

```bash
git commit -m "refactor(admin): extract ItemGroupsManager"
```

---

### Task 9: Extract ItemsManager

**Files:**
- Create: `src/components/admin/ItemsManager.jsx`
- Modify: `src/components/AdminDashboard.jsx` (delete lines 943–1838)

- [ ] **Steps 1–5:** extract → import → build → smoke items tab + CSV upload → commit

---

### Task 10: Extract UsersManager + CategoriesManager

**Files:**
- Create: `src/components/admin/UsersManager.jsx` (lines 1841–1970)
- Create: `src/components/admin/CategoriesManager.jsx` (lines 1973–2267)

- [ ] **Steps 1–5:** both extractions in one task → commit

```bash
git commit -m "refactor(admin): extract UsersManager and CategoriesManager"
```

---

### Task 11: Extract admin modals and editors

**Files:**
- Create: `src/components/admin/modals/UserAssignmentModal.jsx` (2350–2530)
- Create: `src/components/admin/modals/ItemSelectionModal.jsx` (2533–3189)
- Create: `src/components/admin/modals/GroupItemsModal.jsx` (3327–3777)
- Create: `src/components/admin/modals/SessionEditor.jsx` (3780–4195)
- Create: `src/components/admin/modals/ItemEditor.jsx` (4198–4398)
- Create: `src/components/admin/modals/UserEditor.jsx` (4401–4557)
- Create: `src/components/admin/modals/CategoryEditor.jsx` (4560–4660)
- Create: `src/components/admin/modals/LocationEditor.jsx` (4663–4768)
- Create: `src/components/admin/forms/CategoryForm.jsx` (2270–2301)
- Create: `src/components/admin/forms/LocationForm.jsx` (2303–2347)
- Create: `src/components/admin/modals/ItemGroupEditor.jsx` (3192–3324)

- [ ] **Step 1: Move files; fix relative imports**

- [ ] **Step 2: Create barrel** `src/components/admin/modals/index.js` re-exporting all modals

- [ ] **Step 3: `AdminDashboard.jsx` should be ≤500 lines**

- [ ] **Step 4: `npm run build` + admin smoke test all tabs**

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(admin): extract modals and editors to admin/modals/"
```

---

## Phase 4 — ItemsList Decomposition

### Task 12: Extract useSessionCounts hook

**Files:**
- Create: `src/components/items/useSessionCounts.js`
- Modify: `src/components/ItemsList.jsx`

**Interfaces:**
- Produces:

```js
export function useSessionCounts(sessionId, user) {
  return {
    session, items, counts, locations, categories,
    loading, error,
    refreshCountsForItem: (itemId) => Promise<void>,
    subscribeToCounts: () => () => void, // cleanup fn
  };
}
```

- [ ] **Step 1: Write failing test** (extract `validateCountAccess` pattern from `accessControl.test.js`; test hook returns loading=true initially with mocked supabase)

- [ ] **Step 2: Move `fetchSessionData`, `refreshCountsForItem`, `subscribeToCounts` into hook**

- [ ] **Step 3: ItemsList imports hook — file drops by ~250 lines**

- [ ] **Step 4: `npm test -- --run` + manual count flow smoke**

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(items): extract useSessionCounts hook"
```

---

### Task 13: Extract CountEntryPanel

**Files:**
- Create: `src/components/items/CountEntryPanel.jsx`
- Modify: `src/components/ItemsList.jsx`

Move the count modal / entry form UI (search for `showCountModal` render block).

- [ ] **Step 1: Extract component with explicit props**

```js
export function CountEntryPanel({
  item, locations, countLocation, countQuantity, onLocationChange,
  onQuantityChange, onSave, onClose, submitting,
}) { /* ... */ }
```

- [ ] **Step 2: Build + smoke save count**

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor(items): extract CountEntryPanel"
```

---

### Task 14: Extract ItemsListToolbar

**Files:**
- Create: `src/components/items/ItemsListToolbar.jsx`
- Modify: `src/components/ItemsList.jsx`

Move search/filter/header bar. Target: `ItemsList.jsx` ≤400 lines.

- [ ] **Steps 1–3:** extract → build → commit

```bash
git commit -m "refactor(items): extract ItemsListToolbar; ItemsList under 400 lines"
```

---

## Phase 5 — Auth Cleanup + Naming

### Task 15: Simplify AuthContext

**Files:**
- Modify: `src/contexts/AuthContext.jsx`
- Create: `src/lib/services/auth.js`
- Test: `src/test/authContext.test.js`

**Interfaces:**
- Produces: `resolveSession(): Promise<{ user, profile } | null>` — single canonical path

- [ ] **Step 1: Write failing test**

```js
import { describe, it, expect, vi } from 'vitest';
import { resolveSession } from '../lib/services/auth.js';

vi.mock('../lib/db/http.js', () => ({
  http: vi.fn().mockResolvedValue({ data: { user: { id: '1', status: 'active' } } }),
  getToken: () => 'tok',
  setToken: vi.fn(),
}));
// mock profile fetch → active profile
// expect resolveSession returns both user and profile
```

- [ ] **Step 2: Implement resolveSession in auth.js** (token → /auth/me → profile → status check)

- [ ] **Step 3: Replace getInitialSession + onAuthStateChange + signIn profile checks with resolveSession**

- [ ] **Step 4: Delete all `console.log` in AuthContext (keep console.error for real errors)**

- [ ] **Step 5: Replace 2s polling with explicit setToken callback:**

```js
// src/lib/db/http.js
let authListeners = new Set();
export function onTokenChange(fn) { authListeners.add(fn); return () => authListeners.delete(fn); }
export function setToken(t) { /* existing */ authListeners.forEach(fn => fn(getToken())); }
```

```js
// AuthContext — replace setInterval polling:
const unsub = onTokenChange(async (token) => { /* resolveSession */ });
```

- [ ] **Step 6: Run tests + login smoke**

- [ ] **Step 7: Commit**

```bash
git commit -m "refactor(auth): single resolveSession path; remove polling and debug logs"
```

---

### Task 16: Unify role vocabulary (UI uses `user`, not `counter`)

**Files:**
- Modify: `src/components/LoginForm.jsx` (default role `'user'`, label "Counter")
- Modify: `src/components/AdminDashboard.jsx` / `UsersManager.jsx` (option value `user`)
- Modify: `src/components/Home.jsx` (display mapping)
- Modify: `server/src/roles.js` — deprecate mapping; pass-through only
- Test: `server/test/roles.test.js` (update expectations)

**Decision:** DB enum stays `('admin', 'user')`. UI displays "Counter" for `user` role. Delete `counter` string from forms.

- [ ] **Step 1: Update tests to expect `user` not `counter`**

- [ ] **Step 2: Global replace UI `counter` → `user` where it's a role value (not the word "counter" in copy)**

- [ ] **Step 3: Simplify roles.js to identity functions (or delete file + inline)**

- [ ] **Step 4: Run all tests**

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor: unify role vocabulary on user/admin enum"
```

---

### Task 17: Rename supabase imports to db (final strangler step)

**Files:**
- Create: `src/lib/db/compat.js` (move SupabaseCompat classes from api.js)
- Create: `src/lib/db/index.js`
- Modify: `src/lib/api.js` → thin re-export barrel (temporary)
- Modify: all `from '../lib/supabase'` → `from '../lib/db'` across `src/`

- [ ] **Step 1: Move compat classes to db/compat.js; api.js re-exports**

- [ ] **Step 2: Create db/index.js**

```js
export { http, getToken, setToken, onTokenChange } from "./http.js";
export { from, rpc, channel } from "./compat.js"; // named exports wrapping compat
export * from "../services/profiles.js";
// ... all services
```

- [ ] **Step 3: Update imports project-wide** (`rg "from ['\"].*lib/supabase" src/` → fix)

- [ ] **Step 4: Keep supabase.js shim one release:**

```js
export * from "./db/index.js";
```

- [ ] **Step 5: Build + full test suite**

- [ ] **Step 6: Commit**

```bash
git commit -m "refactor(client): rename supabase imports to lib/db"
```

---

## Phase 6 — Integration Verification

### Task 18: Authorization integration tests

**Files:**
- Create: `server/test/restAuth.integration.test.js`
- Requires: test DB or mocked `query` — use mocked `query` for unit-level integration

- [ ] **Step 1: Test matrix**

| Role | GET profiles | GET sessions | POST categories | POST counts (unassigned) |
|------|-------------|-------------|-----------------|-------------------------|
| admin | all | all | 200 | — |
| user | self only | assigned only | 403 | 403 |

- [ ] **Step 2: Implement with mocked Hono app + policy**

- [ ] **Step 3: `npm run test:server` — PASS**

- [ ] **Step 4: Commit**

```bash
git commit -m "test(server): add REST authorization integration tests"
```

---

### Task 19: Final verification checklist

- [ ] Run `npm test -- --run` — 49+ frontend tests PASS
- [ ] Run `npm run test:server` — 10+ server tests PASS
- [ ] Run `npm run build` — no errors
- [ ] Manual smoke script:
  1. Sign up new user (password saved)
  2. Admin login → all tabs work
  3. Counter login → only assigned sessions visible
  4. Save count in active session
  5. History date range filter returns correct rows
  6. ReportStatus realtime update on insert
  7. `GET /health` returns `{ ok: true, db: true }`

- [ ] **Commit any fixes found during smoke**

```bash
git commit -m "chore: post-refactor smoke test fixes"
```

---

## Self-Review Checklist

| Review issue | Task |
|-------------|------|
| 4k-line AdminDashboard | Tasks 7–11 |
| 1.3k-line ItemsList | Tasks 12–14 |
| Supabase compat emulator | Tasks 4–6, 17 |
| authorize Set spaghetti | Task 1 |
| Duplicate RPC guard | Task 3 |
| Realtime filter duplication | Task 2 |
| Domain logic in api.js | Tasks 5–6 |
| AuthContext polling/logs | Task 15 |
| counter/user dual vocabulary | Task 16 |
| Missing auth integration tests | Task 18 |

**Placeholder scan:** No TBD/TODO steps. All file paths and interfaces defined.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-21-maintainability-refactor.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — Fresh subagent per task, review between tasks, fast iteration. Use superpowers:subagent-driven-development.

2. **Inline Execution** — Execute tasks in this session using superpowers:executing-plans with batch checkpoints.

**Which approach?**