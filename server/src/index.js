import "dotenv/config";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { query, withTransaction } from "./db.js";
import { attachRealtime } from "./realtime.js";

const app = createApp({ env: process.env, db: { query, withTransaction } });

const port = Number(process.env.PORT || 3000);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[server] http+ws listening on :${info.port}`);
});

attachRealtime(server);
