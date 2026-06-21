function payloadFor({ table, eventType, row }) {
  return {
    eventType,
    new: eventType === "DELETE" ? null : row,
    old: eventType === "DELETE" ? row : null,
    table,
  };
}

export function createRealtimePublisher(target) {
  if (!target || typeof target.publish !== "function") return null;
  return {
    publish: (message) => target.publish(message),
  };
}

export async function publishRows(publisher, { table, eventType, rows }) {
  if (!publisher || !Array.isArray(rows) || !rows.length) return;
  for (const row of rows) {
    await publisher.publish({
      table,
      payload: payloadFor({ table, eventType, row }),
    });
  }
}

export function createDurableObjectPublisher(env) {
  const namespace = env?.REALTIME;
  if (!namespace) return null;
  return createRealtimePublisher({
    publish: async (message) => {
      const id = namespace.idFromName("global");
      const stub = namespace.get(id);
      await stub.fetch("https://realtime.internal/broadcast", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(message),
      });
    },
  });
}
