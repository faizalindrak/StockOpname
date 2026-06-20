import { buildFilterFragments, quoteIdent } from "./queryBuilder.js";

const ADMIN = "admin";

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
  return {
    filters: [...filters, ...scoped.filters],
    extraClause: scoped.extraClause,
    extraParams: scoped.extraParams,
  };
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

  if ((method === "PATCH" || method === "DELETE") && table === "counts") {
    if (!filters.length) return "Refusing to modify counts without a filter";
    const { clauses, params } = buildFilterFragments(filters);
    const filterResult = await query(
      `select session_id from counts where ${clauses.join(" and ")}`,
      params
    );
    for (const row of filterResult.rows) {
      const assigned = await query(
        "select 1 from session_users where session_id = $1 and user_id = $2 limit 1",
        [row.session_id, user.sub]
      );
      if (!assigned.rows.length) return "You are not assigned to this session";
    }
  }

  return null;
}