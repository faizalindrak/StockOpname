import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildFilters, buildFilterFragments, runSelect } from "../src/queryBuilder.js";

describe("buildFilters", () => {
  it("maps comparison operators to SQL", () => {
    const params = new URLSearchParams({
      "created_at.gte": "2026-01-01",
      "created_at.lte": "2026-12-31",
      "date_input.neq": "2026-06-01",
    });
    const filters = buildFilters(params);
    assert.equal(filters[0].op, ">=");
    assert.equal(filters[1].op, "<=");
    assert.equal(filters[2].op, "!=");
  });

  it("builds SQL fragments for neq and ranges", () => {
    const filters = [
      { column: "created_at", op: ">=", value: "2026-01-01" },
      { column: "created_at", op: "<=", value: "2026-12-31" },
    ];
    const { clauses, params } = buildFilterFragments(filters);
    assert.deepEqual(clauses, ['"created_at" >= $1', '"created_at" <= $2']);
    assert.deepEqual(params, ["2026-01-01", "2026-12-31"]);
  });
});

describe("runSelect", () => {
  it("passes offset extra clause placeholders without gaps", async () => {
    const calls = [];
    const db = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        return { rows: [] };
      },
    };

    await runSelect({
      table: "sessions",
      select: "*",
      filters: [{ column: "status", op: "=", value: "active" }],
      extraClause: '"id" IN (SELECT session_id FROM session_users WHERE user_id = $1)',
      extraParams: ["user-1"],
      db,
    });

    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /"status" = \$1/);
    assert.match(calls[0].sql, /user_id = \$2/);
    assert.deepEqual(calls[0].params, ["active", "user-1"]);
  });
});
