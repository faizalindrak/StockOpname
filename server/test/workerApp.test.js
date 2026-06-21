import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../src/app.js";
import { signToken } from "../src/auth.js";

describe("createApp", () => {
  it("builds a fetch-compatible Hono app with injected database services", async () => {
    const app = createApp({
      env: { CORS_ORIGIN: "https://app.example.com" },
      db: {
        query: async () => ({ rows: [{ ok: 1 }] }),
      },
    });

    const response = await app.request("http://localhost/health");
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { ok: true, db: true });
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://app.example.com");
  });

  it("verifies protected routes with the Worker JWT secret", async () => {
    const workerSecret = "worker-secret-for-test";
    const token = await signToken({ sub: "user-1", email: "u@example.com", role: "admin" }, workerSecret);
    const app = createApp({
      env: { JWT_SECRET: workerSecret },
      db: {
        query: async (sql, params) => {
          assert.match(sql, /from profiles/);
          assert.deepEqual(params, ["user-1"]);
          return { rows: [{ id: "user-1", email: "u@example.com", name: "User", username: "user", role: "admin", status: "active" }] };
        },
      },
    });

    const accepted = await app.request("http://localhost/auth/me", {
      headers: { authorization: `Bearer ${token}` },
    });
    const rejected = await app.request("http://localhost/auth/me", {
      headers: { authorization: `Bearer ${await signToken({ sub: "user-1" }, "wrong-secret")}` },
    });

    assert.equal(accepted.status, 200);
    assert.equal(rejected.status, 401);
  });
});
