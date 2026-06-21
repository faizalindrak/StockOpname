import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { roleToDb, roleFromDb, mapUserRole } from "../src/roles.js";

describe("role mapping", () => {
  it("maps counter to user for storage", () => {
    assert.equal(roleToDb("counter"), "user");
    assert.equal(roleToDb("admin"), "admin");
  });

  it("keeps user role in API responses", () => {
    assert.equal(roleFromDb("user"), "user");
    assert.equal(mapUserRole({ id: "1", role: "user" }).role, "user");
  });
});