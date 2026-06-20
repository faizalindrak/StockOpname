import { Hono } from "hono";
import { query } from "../db.js";
import { runSelect, buildFilters, buildFilterFragments, quoteIdent } from "../queryBuilder.js";
import { authorizeWrite, scopeReadFilters, canCallRpc } from "../authorize.js";
import { mapUserRole } from "../roles.js";

const router = new Hono();

function safeTable(name) {
  if (!/^[a-zA-Z_][\w]*$/.test(name)) throw new Error(`Invalid table: ${name}`);
  return name;
}

function mapTableRows(table, rows) {
  if (table === "profiles") return rows.map(mapUserRole);
  return rows;
}

// GET /rest/:table -> list rows
router.get("/:table", async (c) => {
  const table = safeTable(c.req.param("table"));
  const user = c.get("user");
  const url = new URL(c.req.url);
  const select = url.searchParams.get("select") || "*";
  const filters = buildFilters(url.searchParams);
  const { filters: scopedFilters, extraClause, extraParams } = scopeReadFilters(table, user, filters);
  const orExpr = url.searchParams.get("or") || undefined;
  let orderColumn = null;
  let ascending = true;
  const orderParam = url.searchParams.get("order");
  if (orderParam) {
    const desc = orderParam.startsWith("-");
    orderColumn = desc ? orderParam.slice(1) : orderParam;
    ascending = !desc;
  }
  let range = null;
  const limit = url.searchParams.get("limit");
  const offset = url.searchParams.get("offset");
  if (limit) range = { limit: Number(limit), offset: Number(offset || 0) };
  try {
    const rows = await runSelect({
      table, select, filters: scopedFilters, orFilter: orExpr,
      order: orderColumn ? { column: orderColumn, ascending } : null,
      range, extraClause, extraParams, db: { query },
    });
    const data = mapTableRows(table, rows);
    return c.json({ data, error: null, count: data.length });
  } catch (e) {
    return c.json({ data: null, error: { message: e.message } }, 400);
  }
});

// POST /rest/:table -> insert
router.post("/:table", async (c) => {
  const table = safeTable(c.req.param("table"));
  const user = c.get("user");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return c.json({ error: "JSON body required" }, 400);
  }
  const denied = await authorizeWrite(table, user, { method: "POST", body }, { query });
  if (denied) return c.json({ error: denied }, 403);
  const rows = Array.isArray(body) ? body : [body];
  try {
    const inserted = [];
    for (const row of rows) {
      const cols = Object.keys(row);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
      const colSql = cols.map(quoteIdent).join(",");
      const values = cols.map((k) => row[k]);
      const sql = `insert into ${quoteIdent(table)} (${colSql}) values (${placeholders}) returning *`;
      const r = await query(sql, values);
      inserted.push(...r.rows);
    }
    return c.json({ data: mapTableRows(table, inserted), error: null });
  } catch (e) {
    return c.json({ data: null, error: { message: e.message } }, 400);
  }
});

// PATCH /rest/:table -> update with filters
router.patch("/:table", async (c) => {
  const table = safeTable(c.req.param("table"));
  const user = c.get("user");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return c.json({ error: "JSON body required" }, 400);
  }
  const url = new URL(c.req.url);
  const filters = buildFilters(url.searchParams);
  if (!filters.length) {
    return c.json({ error: "Refusing to update without a filter" }, 400);
  }
  const denied = await authorizeWrite(table, user, { method: "PATCH", body, filters }, { query });
  if (denied) return c.json({ error: denied }, 403);
  const updates = body;
  const updateKeys = Object.keys(updates);
  if (!updateKeys.length) {
    return c.json({ error: "No fields to update" }, 400);
  }
  try {
    const setFragments = updateKeys.map((k, i) => `${quoteIdent(k)} = $${i + 1}`);
    const filterResult = buildFilterFragments(filters, updateKeys.length + 1);
    const params = [...updateKeys.map((k) => updates[k]), ...filterResult.params];
    const sql = `update ${quoteIdent(table)} set ${setFragments.join(", ")} where ${filterResult.clauses.join(" and ")} returning *`;
    const r = await query(sql, params);
    return c.json({ data: mapTableRows(table, r.rows), error: null });
  } catch (e) {
    return c.json({ data: null, error: { message: e.message } }, 400);
  }
});

// DELETE /rest/:table
router.delete("/:table", async (c) => {
  const table = safeTable(c.req.param("table"));
  const user = c.get("user");
  const url = new URL(c.req.url);
  const filters = buildFilters(url.searchParams);
  if (!filters.length) {
    return c.json({ error: "Refusing to delete without a filter" }, 400);
  }
  const denied = await authorizeWrite(table, user, { method: "DELETE", body: null, filters }, { query });
  if (denied) return c.json({ error: denied }, 403);
  try {
    const filterResult = buildFilterFragments(filters);
    const sql = `delete from ${quoteIdent(table)} where ${filterResult.clauses.join(" and ")}`;
    const r = await query(sql, filterResult.params);
    return c.json({ data: r.rowCount, error: null });
  } catch (e) {
    return c.json({ data: null, error: { message: e.message } }, 400);
  }
});

// POST /rest/rpc/:fn -> call a stored function
router.post("/rpc/:fn", (c) => handleRpc(c));

export async function handleRpc(c) {
  const user = c.get("user");
  if (!canCallRpc(user)) {
    return c.json({ error: "Only administrators can call RPC functions" }, 403);
  }
  const fn = c.req.param("fn");
  if (!/^[a-zA-Z_][\w]*$/.test(fn)) {
    return c.json({ error: "Invalid function name" }, 400);
  }
  const body = await c.req.json().catch(() => ({}));
  const keys = Object.keys(body);
  const namedPlaceholders = keys.map((k, i) => {
    if (!/^[a-zA-Z_][\w]*$/.test(k)) throw new Error(`Invalid parameter name: ${k}`);
    return `${quoteIdent(k)} := $${i + 1}`;
  }).join(", ");
  const params = keys.map((k) => body[k]);
  try {
    const sql = `select ${quoteIdent(fn)}(${namedPlaceholders}) as result`;
    const r = await query(sql, params);
    return c.json({ data: r.rows[0]?.result ?? null, error: null });
  } catch (e) {
    return c.json({ data: null, error: { message: e.message } }, 400);
  }
}

export default router;