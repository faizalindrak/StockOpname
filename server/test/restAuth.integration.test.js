import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scopeRead, authorizeWrite } from "../src/policy.js";

const counter = { sub: "user-1", role: "user" };
const admin = { sub: "admin-1", role: "admin" };

describe("REST authorization matrix", () => {
  it("counter GET profiles is scoped to self", () => {
    const { filters } = scopeRead("profiles", counter, []);
    assert.equal(filters.some((f) => f.column === "id" && f.value === "user-1"), true);
  });

  it("counter GET sessions is scoped to assignments", () => {
    const { extraClause } = scopeRead("sessions", counter, []);
    assert.match(extraClause, /session_users/);
  });

  it("counter POST categories is denied", async () => {
    const msg = await authorizeWrite("categories", counter, { method: "POST", body: { name: "x" } }, { query: async () => ({ rows: [] }) });
    assert.equal(msg, "Only administrators can create records in this table");
  });

  it("admin POST categories is allowed", async () => {
    const msg = await authorizeWrite("categories", admin, { method: "POST", body: { name: "x" } }, { query: async () => ({ rows: [] }) });
    assert.equal(msg, null);
  });
});