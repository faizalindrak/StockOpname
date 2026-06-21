import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canCallRpc } from "../src/policy.js";

describe("RPC auth", () => {
  it("counter cannot call rpc", () => {
    assert.equal(canCallRpc({ role: "user" }), false);
  });

  it("admin can call rpc", () => {
    assert.equal(canCallRpc({ role: "admin" }), true);
  });
});