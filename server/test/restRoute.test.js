import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgresql://user:password@localhost:5432/test";

const { handleDelete, handleInsert } = await import("../src/routes/rest.js");

function createContext({ table, user = { sub: "admin-1", role: "admin" }, body = null, url = `http://localhost/rest/${table}` }) {
  return {
    req: {
      param: (name) => (name === "table" ? table : null),
      url,
      json: async () => body,
    },
    get: (key) => (key === "user" ? user : undefined),
    json: (payload, status = 200) => ({ payload, status }),
  };
}

describe("REST route helpers", () => {
  it("uses a transaction for bulk inserts", async () => {
    const calls = [];
    const ctx = createContext({
      table: "categories",
      body: [{ name: "A" }, { name: "B" }],
    });
    const tx = async (fn) => {
      calls.push(["BEGIN"]);
      const result = await fn({
        query: async (sql, params) => {
          calls.push([sql, params]);
          return { rows: [{ id: params[0], name: params[0] }] };
        },
      });
      calls.push(["COMMIT"]);
      return result;
    };

    const response = await handleInsert(ctx, { tx });

    assert.equal(response.status, 200);
    assert.deepEqual(response.payload.data.map((row) => row.name), ["A", "B"]);
    assert.equal(calls[0][0], "BEGIN");
    assert.equal(calls.at(-1)[0], "COMMIT");
    assert.equal(calls.filter(([sql]) => String(sql).startsWith("insert into")).length, 2);
  });

  it("uses requested insert select columns for returning data", async () => {
    const calls = [];
    const ctx = createContext({
      table: "categories",
      body: { name: "A", description: "Hidden" },
      url: "http://localhost/rest/categories?select=id,name",
    });
    const tx = async (fn) => fn({
      query: async (sql, params) => {
        calls.push([sql, params]);
        return { rows: [{ id: "category-1", name: params[0] }] };
      },
    });

    const response = await handleInsert(ctx, { tx });

    assert.equal(response.status, 200);
    assert.match(calls[0][0], /returning "id", "name"$/);
    assert.deepEqual(response.payload.data, [{ id: "category-1", name: "A" }]);
  });

  it("rolls back bulk inserts when a later row fails", async () => {
    const calls = [];
    const ctx = createContext({
      table: "categories",
      body: [{ name: "A" }, { name: "B" }],
    });
    const tx = async (fn) => {
      calls.push(["BEGIN"]);
      try {
        const result = await fn({
          query: async (sql, params) => {
            calls.push([sql, params]);
            if (params[0] === "B") throw new Error("duplicate category");
            return { rows: [{ id: params[0], name: params[0] }] };
          },
        });
        calls.push(["COMMIT"]);
        return result;
      } catch (error) {
        calls.push(["ROLLBACK"]);
        throw error;
      }
    };

    const response = await handleInsert(ctx, { tx });

    assert.equal(response.status, 400);
    assert.equal(response.payload.error.message, "duplicate category");
    assert.equal(calls.at(-1)[0], "ROLLBACK");
    assert.equal(calls.some(([entry]) => entry === "COMMIT"), false);
  });

  it("returns deleted rows instead of only row count", async () => {
    const ctx = createContext({
      table: "categories",
      url: "http://localhost/rest/categories?id.eq=category-1",
    });

    const response = await handleDelete(ctx, {
      dbQuery: async (sql, params) => {
        assert.match(sql, /delete from "categories"/);
        assert.match(sql, /returning \*/);
        assert.deepEqual(params, ["category-1"]);
        return { rows: [{ id: "category-1", name: "Archived" }], rowCount: 1 };
      },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(response.payload.data, [{ id: "category-1", name: "Archived" }]);
  });
});
