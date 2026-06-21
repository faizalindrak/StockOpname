import { Hono } from "hono";
import { runSelect, buildFilters, buildFilterFragments, quoteIdent } from "../queryBuilder.js";
import { authorizeWrite, scopeReadFilters, canCallRpc } from "../authorize.js";
import { mapUserRole } from "../roles.js";
import { getDb, getRealtime } from "../requestServices.js";
import { publishRows } from "../realtimePublisher.js";

const router = new Hono();

function safeTable(name) {
  if (!/^[a-zA-Z_][\w]*$/.test(name)) throw new Error(`Invalid table: ${name}`);
  return name;
}

function mapTableRows(table, rows) {
  if (table === "profiles") return rows.map(mapUserRole);
  return rows;
}

function buildReturningClause(select) {
  const selectedColumns = (select || "*").trim();
  if (!selectedColumns || selectedColumns === "*") return "*";
  return selectedColumns
    .split(",")
    .map((column) => quoteIdent(column.trim()))
    .join(", ");
}

// GET /rest/:table -> list rows
router.get("/:table", async (c) => {
  const db = getDb(c);
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
       range, extraClause, extraParams, db,
    });
    const data = mapTableRows(table, rows);
    return c.json({ data, error: null, count: data.length });
  } catch (e) {
    return c.json({ data: null, error: { message: e.message } }, 400);
  }
});

// POST /rest/:table -> insert
export async function handleInsert(c, { dbQuery, tx } = {}) {
  const db = dbQuery || tx ? {} : getDb(c);
  const activeQuery = dbQuery || db.query;
  const activeTx = tx || db.withTransaction;
  const table = safeTable(c.req.param("table"));
  const user = c.get("user");
  const url = new URL(c.req.url);
  const returning = buildReturningClause(url.searchParams.get("select"));
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return c.json({ error: "JSON body required" }, 400);
  }
  const denied = await authorizeWrite(table, user, { method: "POST", body }, { query: activeQuery });
  if (denied) return c.json({ error: denied }, 403);
  const rows = Array.isArray(body) ? body : [body];
  try {
    const inserted = await activeTx(async (client) => {
      const insertedRows = [];
      for (const row of rows) {
        const cols = Object.keys(row);
        if (!cols.length) throw new Error("Insert row must include at least one field");
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
        const colSql = cols.map(quoteIdent).join(",");
        const values = cols.map((k) => row[k]);
        const sql = `insert into ${quoteIdent(table)} (${colSql}) values (${placeholders}) returning ${returning}`;
        const r = await client.query(sql, values);
        insertedRows.push(...r.rows);
      }
      return insertedRows;
    });
    const data = mapTableRows(table, inserted);
    await publishRows(getRealtime(c), { table, eventType: "INSERT", rows: data });
    return c.json({ data, error: null });
  } catch (e) {
    return c.json({ data: null, error: { message: e.message } }, 400);
  }
}

router.post("/:table", (c) => handleInsert(c));

// PATCH /rest/:table -> update with filters
router.patch("/:table", async (c) => {
  const db = getDb(c);
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
  const denied = await authorizeWrite(table, user, { method: "PATCH", body, filters }, { query: db.query });
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
    const r = await db.query(sql, params);
    const data = mapTableRows(table, r.rows);
    await publishRows(getRealtime(c), { table, eventType: "UPDATE", rows: data });
    return c.json({ data, error: null });
  } catch (e) {
    return c.json({ data: null, error: { message: e.message } }, 400);
  }
});

// DELETE /rest/:table
export async function handleDelete(c, { dbQuery } = {}) {
  const db = dbQuery ? {} : getDb(c);
  const activeQuery = dbQuery || db.query;
  const table = safeTable(c.req.param("table"));
  const user = c.get("user");
  const url = new URL(c.req.url);
  const filters = buildFilters(url.searchParams);
  if (!filters.length) {
    return c.json({ error: "Refusing to delete without a filter" }, 400);
  }
  const denied = await authorizeWrite(table, user, { method: "DELETE", body: null, filters }, { query: activeQuery });
  if (denied) return c.json({ error: denied }, 403);
  try {
    const filterResult = buildFilterFragments(filters);
    const sql = `delete from ${quoteIdent(table)} where ${filterResult.clauses.join(" and ")} returning *`;
    const r = await activeQuery(sql, filterResult.params);
    const data = mapTableRows(table, r.rows);
    await publishRows(getRealtime(c), { table, eventType: "DELETE", rows: data });
    return c.json({ data, error: null });
  } catch (e) {
    return c.json({ data: null, error: { message: e.message } }, 400);
  }
}

router.delete("/:table", (c) => handleDelete(c));

// POST /rest/rpc/:fn -> call a stored function
router.post("/rpc/:fn", (c) => handleRpc(c));

export async function handleRpc(c) {
  const db = getDb(c);
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
    const r = await db.query(sql, params);
    return c.json({ data: r.rows[0]?.result ?? null, error: null });
  } catch (e) {
    return c.json({ data: null, error: { message: e.message } }, 400);
  }
}

export default router;
