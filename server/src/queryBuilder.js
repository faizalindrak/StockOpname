// Translates a PostgREST-style select string into a SQL select clause and
// a list of embedded relations to fetch (one extra query per relation).
//
// Examples we need to support, taken from the existing client code:
//   "*"
//   "id, sku, item_name"
//   "*, session_users (user_id)"
//   "*, item_group_items(item_id)"
//   "*, locations ( name )"
//
// Convention: embedded relations are expressed as `table ( col1, col2 )`.
// For many-to-one joins we look for a foreign key from the child table to
// the parent (e.g. session_items.session_id -> sessions.id). For one-to-many
// embeds (e.g. sessions -> session_users) we look for a foreign key from the
// embed table to the parent (e.g. session_users.session_id -> sessions.id).
//
// The `or` parameter supports Supabase syntax:
//   "sku.in.(SKU1,SKU2),internal_product_code.in.(C1,C2)"

const RELATION_HINTS = {
  sessions: { embeds: { session_users: { fk: "session_id", parentKey: "id" } } },
  item_groups: { embeds: { item_group_items: { fk: "item_group_id", parentKey: "id" } } },
  session_items: { embeds: { items: { fk: "item_id", parentKey: "id", oneToOne: true } } },
  counts: {
    embeds: {
      items: { fk: "item_id", parentKey: "id", oneToOne: true },
      locations: { fk: "location_id", parentKey: "id", oneToOne: true },
    },
  },
  profiles: { embeds: {} },
  items: { embeds: {} },
  categories: { embeds: {} },
  locations: { embeds: {} },
  report_status_raw_mat: { embeds: {} },
  location_usage: { embeds: {} },
};

function tokenizeSelect(select) {
  const tokens = [];
  let depth = 0;
  let buf = "";
  for (const ch of select) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      tokens.push(buf.trim());
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) tokens.push(buf.trim());
  return tokens;
}

export function parseSelect(select) {
  const sel = (select || "*").trim();
  const tokens = tokenizeSelect(sel);
  const columns = [];
  const embeds = [];

  for (const tok of tokens) {
    const m = tok.match(/^([a-zA-Z_][\w]*)\s*\(([^)]*)\)$/);
    if (m) {
      const table = m[1];
      const cols = m[2].split(",").map((c) => c.trim()).filter(Boolean);
      embeds.push({ table, columns: cols.length ? cols : ["*"] });
    } else {
      columns.push(tok);
    }
  }

  // If no columns were found (only embeds), default to "*"
  if (!columns.length) columns.push("*");

  return { columns, embeds };
}

export function quoteIdent(name) {
  if (!/^[a-zA-Z_][\w]*$/.test(name)) {
    throw new Error(`Invalid identifier: ${name}`);
  }
  return `"${name}"`;
}

function buildSelectClause(columns) {
  if (!columns.length || (columns.length === 1 && columns[0] === "*")) return "*";
  return columns.map(quoteIdent).join(", ");
}

function buildEmbedQueries(parentTable, rows, embeds) {
  if (!rows.length || !embeds.length) return [];
  const out = [];
  for (const emb of embeds) {
    const hint = RELATION_HINTS[parentTable]?.embeds?.[emb.table];
    if (!hint) continue;
    const fk = hint.fk;
    const parentKey = hint.parentKey || "id";
    const parentIds = [...new Set(rows.map((r) => r[parentKey]).filter((v) => v != null))];
    if (!parentIds.length) {
      out.push({ table: emb.table, alias: emb.table, columns: emb.columns, rows: [] });
      continue;
    }
    const selectCols = emb.columns.includes("*")
      ? "*"
      : emb.columns.map(quoteIdent).join(", ");
    const sql = `select ${selectCols} from ${quoteIdent(emb.table)} where ${quoteIdent(fk)} = any($1::uuid[])`;
    out.push({ sql, params: [parentIds], table: emb.table, alias: emb.table, columns: emb.columns, fk, parentKey });
  }
  return out;
}

export async function runSelect({ table, select, filters, order, range, single, orFilter, extraClause, extraParams, db }) {
  const { columns, embeds } = parseSelect(select);
  const where = [];
  const params = [];
  let i = 1;

  for (const f of filters || []) {
    where.push(`${quoteIdent(f.column)} ${f.op} $${i++}`);
    params.push(f.value);
  }

  // Merge OR filter into the WHERE clause if present
  let orSql = "";
  let orParams = [];
  if (orFilter) {
    const parsed = buildOrFilter(orFilter, params);
    if (parsed.sql) {
      orSql = parsed.sql;
      orParams = parsed.params;
      i = params.length + orParams.length + 1;
    }
  }

  const whereParts = [];
  if (where.length) whereParts.push(where.join(" and "));
  if (orSql) whereParts.push(orSql);
  let allParams = [...params, ...orParams];
  if (extraClause) {
    const offset = allParams.length;
    const clause = extraClause.replace(/\$(\d+)/g, (_, n) => `$${offset + Number(n)}`);
    whereParts.push(clause);
    allParams = [...allParams, ...(extraParams || [])];
  }
  const whereSql = whereParts.length ? `where ${whereParts.join(" and ")}` : "";

  const orderSql = order
    ? `order by ${quoteIdent(order.column)} ${order.ascending ? "asc" : "desc"}`
    : "";
  const limit = range ? `limit ${range.limit} offset ${range.offset}` : "";
  const sql = `select ${buildSelectClause(columns)} from ${quoteIdent(table)} ${whereSql} ${orderSql} ${limit}`;
  const result = await db.query(sql, allParams);
  let rows = result.rows;
  const embedQueries = buildEmbedQueries(table, rows, embeds);
  const embedResults = [];
  for (const eq of embedQueries) {
    if (eq.sql) {
      const r = await db.query(eq.sql, eq.params);
      embedResults.push({ ...eq, rows: r.rows });
    } else {
      embedResults.push(eq);
    }
  }
  for (const emb of embedResults) {
    if (!rows.length) break;
    const hint = RELATION_HINTS[table]?.embeds?.[emb.table];
    if (!hint) continue;
    const fk = hint.fk;
    const parentKey = hint.parentKey || "id";
    const grouped = new Map();
    for (const r of emb.rows) {
      const key = r[fk];
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(r);
    }
    for (const row of rows) {
      const list = grouped.get(row[parentKey]) || [];
      row[emb.alias] = hint.oneToOne ? list[0] || null : list;
    }
  }
  return single ? rows[0] || null : rows;
}

const FILTER_OP_SQL = {
  eq: "=",
  neq: "!=",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
};

export function buildFilters(searchParams) {
  const filters = [];
  for (const [rawKey, rawVal] of searchParams.entries()) {
    const m = rawKey.match(/^([a-zA-Z_][\w]*)\.(eq|neq|gt|gte|lt|lte|in|like|ilike)$/);
    if (!m) continue;
    const column = m[1];
    const op = m[2];
    if (op === "in") {
      const arr = rawVal.split(",").map((v) => v.trim()).filter(Boolean);
      filters.push({ column, op: "= any", value: arr });
    } else if (op === "ilike") {
      filters.push({ column, op: "ilike", value: `%${rawVal}%` });
    } else if (op === "like") {
      filters.push({ column, op: "like", value: `%${rawVal}%` });
    } else {
      filters.push({ column, op: FILTER_OP_SQL[op] || "=", value: rawVal });
    }
  }
  return filters;
}


/**
 * Converts the uildFilters output into SQL WHERE clause fragments with
 * positional placeholders. Used by PATCH and DELETE routes in rest.js.
 *
 * @param {{ column: string; op: string; value: any }[]} filters
 * @param {number} [startIndex=1] - Starting placeholder number
 * @returns {{ clauses: string[]; params: any[] }}
 */
export function buildFilterFragments(filters, startIndex = 1) {
  const clauses = [];
  const params = [];
  let i = startIndex;
  for (const f of filters || []) {
    if (f.op === "= any") {
      // IN clause — value is an array
      const placeholders = f.value.map(() => `$${i++}`).join(", ");
      clauses.push(`${quoteIdent(f.column)} IN (${placeholders})`);
      params.push(...f.value);
    } else {
      clauses.push(`${quoteIdent(f.column)} ${f.op} $${i++}`);
      params.push(f.value);
    }
  }
  return { clauses, params };
}

export function buildOrFilter(orExpr, baseParams = []) {
  // orExpr example: "sku.in.(SKU1,SKU2),internal_product_code.in.(C1,C2)"
  if (!orExpr) return { sql: "", params: [] };
  const parts = orExpr.split(",");
  const clauses = [];
  const params = [];
  let i = baseParams.length + 1;
  for (const p of parts) {
    const m = p.match(/^([a-zA-Z_][\w]*)\.in\.\(([^)]+)\)$/);
    if (m) {
      const col = m[1];
      const arr = m[2].split(",").map((v) => v.replace(/^"|"$/g, "").trim()).filter(Boolean);
      if (arr.length) {
        const placeholders = arr.map(() => `$${i++}`).join(",");
        clauses.push(`${quoteIdent(col)} in (${placeholders})`);
        params.push(...arr);
      }
    } else {
      const m2 = p.match(/^([a-zA-Z_][\w]*)\.(eq|neq)\.\(([^)]+)\)$/);
      if (m2) {
        const col = m2[1];
        const op = m2[2];
        const val = m2[3];
        clauses.push(`${quoteIdent(col)} ${op === "eq" ? "=" : "!="} $${i++}`);
        params.push(val);
      }
    }
  }
  return { sql: clauses.length ? `(${clauses.join(" or ")})` : "", params };
}
