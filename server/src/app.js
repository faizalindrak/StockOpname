import { Hono } from "hono";
import { authMiddleware, DEFAULT_JWT_SECRET } from "./auth.js";
import authRoutes from "./routes/auth.js";
import restRoutes from "./routes/rest.js";
import rpcRoutes from "./routes/rpc.js";
import { createRealtimePublisher } from "./realtimePublisher.js";

export function createApp({ env = {}, db, realtime } = {}) {
  const app = new Hono();
  const realtimePublisher = createRealtimePublisher(realtime);
  const authSecret = env.JWT_SECRET || DEFAULT_JWT_SECRET;

  app.use("*", async (c, next) => {
    if (db) c.set("db", db);
    if (realtimePublisher) c.set("realtime", realtimePublisher);
    if (authSecret) c.set("authSecret", authSecret);
    const origin = env.CORS_ORIGIN || "http://localhost:5173";
    c.res.headers.set("Access-Control-Allow-Origin", origin);
    c.res.headers.set("Access-Control-Allow-Credentials", "true");
    c.res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    c.res.headers.set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    if (c.req.method === "OPTIONS") return c.body(null, 204);
    await next();
  });

  app.get("/health", async (c) => {
    try {
      const activeDb = c.get("db") || db;
      if (activeDb?.query) await activeDb.query("select 1 as ok");
      return c.json({ ok: true, db: true });
    } catch (e) {
      return c.json({ ok: false, db: false, error: e.message }, 503);
    }
  });

  app.route("/auth", authRoutes);
  app.use("/rest/*", authMiddleware);
  app.use("/rpc/*", authMiddleware);
  app.route("/rest", restRoutes);
  app.route("/rpc", rpcRoutes);

  return app;
}
