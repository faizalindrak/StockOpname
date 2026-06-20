import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { recordMatchesRealtimeFilter } from "../src/realtimeFilters.js";

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