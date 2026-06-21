import { Client } from "@neondatabase/serverless";

export function createWorkerDb(env) {
  return {
    query: async (text, params) => {
      const client = new Client(env.DATABASE_URL);
      await client.connect();
      try {
        return await client.query(text, params);
      } finally {
        await client.end();
      }
    },
    withTransaction: async (fn) => {
      const client = new Client(env.DATABASE_URL);
      await client.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the original transaction failure; rollback errors are secondary.
        }
        throw error;
      } finally {
        await client.end();
      }
    },
  };
}
