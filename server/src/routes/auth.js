import { Hono } from "hono";
import { query } from "../db.js";
import { hashPassword, checkPassword, signToken, authMiddleware } from "../auth.js";
import { mapUserRole, roleToDb } from "../roles.js";

const router = new Hono();

router.post("/signup", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { email, password, name, username, role = "user", status = "inactive" } = body;
  const dbRole = roleToDb(role);
  if (!email || !password || !name || !username) {
    return c.json({ error: "email, password, name, username are required" }, 400);
  }
  const existing = await query("select id from profiles where email = $1 limit 1", [email]);
  if (existing.rows.length) {
    return c.json({ error: "A profile with this email already exists" }, 409);
  }
  const password_hash = await hashPassword(password);
  const inserted = await query(
    `insert into profiles (email, name, username, role, status, password_hash)
     values ($1, $2, $3, $4, $5, $6) returning id, email, name, username, role, status`,
    [email, name, username, dbRole, status, password_hash]
  );
  const user = mapUserRole(inserted.rows[0]);
  const token = signToken({ sub: user.id, email: user.email, role: roleToDb(user.role) });
  return c.json({ data: { user, session: { access_token: token, user } }, error: null });
});

router.post("/signin", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { email, password } = body;
  if (!email || !password) {
    return c.json({ error: "email and password are required" }, 400);
  }
  const result = await query(
    "select id, email, name, username, role, status, password_hash from profiles where email = $1 limit 1",
    [email]
  );
  const user = result.rows[0];
  if (!user || !user.password_hash) {
    return c.json({ error: "Invalid email or password" }, 401);
  }
  const ok = await checkPassword(password, user.password_hash);
  if (!ok) {
    return c.json({ error: "Invalid email or password" }, 401);
  }
  const token = signToken({ sub: user.id, email: user.email, role: user.role });
  const { password_hash, ...safeUser } = user;
  const clientUser = mapUserRole(safeUser);
  return c.json({ data: { user: clientUser, session: { access_token: token, user: clientUser } }, error: null });
});

router.post("/signout", (c) => c.json({ data: { ok: true }, error: null }));

// Protected /me endpoint
router.get("/me", authMiddleware, async (c) => {
  const u = c.get("user");
  const result = await query(
    "select id, email, name, username, role, status from profiles where id = $1",
    [u.sub]
  );
  const user = result.rows[0];
  if (!user) return c.json({ error: "User not found" }, 404);
  return c.json({ data: { user: mapUserRole(user) }, error: null });
});

export default router;
