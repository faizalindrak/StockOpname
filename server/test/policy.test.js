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

  it("does not scope for admin", () => {
    const { filters, extraClause } = scopeRead("profiles", admin, []);
    assert.equal(filters.length, 0);
    assert.equal(extraClause, null);
  });
});

describe("canCallRpc", () => {
  it("allows admin only", () => {
    assert.equal(canCallRpc(admin), true);
    assert.equal(canCallRpc(counter), false);
  });
});