import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { recordMatchesRealtimeFilter } from "../src/realtimeFilters.js";
import { signToken, verifyToken } from "../src/auth.js";

describe("recordMatchesRealtimeFilter", () => {
  const record = { session_id: "abc-123", date_input: "2026-06-01" };

  it("accepts Supabase filter syntax", () => {
    assert.equal(recordMatchesRealtimeFilter("session_id=eq.abc-123", record), true);
    assert.equal(recordMatchesRealtimeFilter("session_id=eq.other", record), false);
  });

  it("accepts dot filter syntax", () => {
    assert.equal(recordMatchesRealtimeFilter("date_input.eq.2026-06-01", record), true);
    assert.equal(recordMatchesRealtimeFilter("date_input.neq.2026-06-01", record), false);
  });
});

describe("realtime auth token verification", () => {
  it("rejects invalid tokens instead of treating async verification as truthy", async () => {
    const token = await signToken({ sub: "user-1" }, "right-secret");

    assert.equal(await verifyToken(token, "right-secret").then((payload) => payload.sub), "user-1");
    assert.equal(await verifyToken(token, "wrong-secret"), null);
  });
});
