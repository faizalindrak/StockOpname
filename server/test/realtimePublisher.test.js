import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createRealtimePublisher, publishRows } from "../src/realtimePublisher.js";

describe("realtime publisher", () => {
  it("publishes one postgres_changes payload per inserted row", async () => {
    const calls = [];
    const publisher = createRealtimePublisher({
      publish: async (message) => calls.push(message),
    });

    await publishRows(publisher, {
      table: "counts",
      eventType: "INSERT",
      rows: [{ id: "count-1" }, { id: "count-2" }],
    });

    assert.deepEqual(calls, [
      { table: "counts", payload: { eventType: "INSERT", new: { id: "count-1" }, old: null, table: "counts" } },
      { table: "counts", payload: { eventType: "INSERT", new: { id: "count-2" }, old: null, table: "counts" } },
    ]);
  });

  it("uses deleted rows as old payload values", async () => {
    const calls = [];
    const publisher = createRealtimePublisher({
      publish: async (message) => calls.push(message),
    });

    await publishRows(publisher, {
      table: "categories",
      eventType: "DELETE",
      rows: [{ id: "category-1" }],
    });

    assert.deepEqual(calls, [
      { table: "categories", payload: { eventType: "DELETE", new: null, old: { id: "category-1" }, table: "categories" } },
    ]);
  });
});
