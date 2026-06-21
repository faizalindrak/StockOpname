import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { authMiddleware } from "./auth.js";
import authRoutes from "./routes/auth.js";
import restRoutes from "./routes/rest.js";
import rpcRoutes from "./routes/rpc.js";
import { attachRealtime } from "./realtime.js";
import { query } from "./db.js";

const app = new Hono();

app.use("*", async (c, next) => {
  const origin = process.env.CORS_ORIGIN || "http://localhost:5173";
  c.res.headers.set("Access-Control-Allow-Origin", origin);
  c.res.headers.set("Access-Control-Allow-Credentials", "true");
  c.res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  c.res.headers.set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  if (c.req.method === "OPTIONS") return c.body(null, 204);
  await next();
});

app.get("/health", async (c) => {
  try {
    await query("select 1 as ok");
    return c.json({ ok: true, db: true });
  } catch (e) {
    return c.json({ ok: false, db: false, error: e.message }, 503);
  }
});

// Public auth endpoints
app.route("/auth", authRoutes);

// Authenticated REST + RPC endpoints
app.use("/rest/*", authMiddleware);
app.use("/rpc/*", authMiddleware);
app.route("/rest", restRoutes);
app.route("/rpc", rpcRoutes);

const port = Number(process.env.PORT || 3000);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[server] http+ws listening on :${info.port}`);
});

attachRealtime(server);
