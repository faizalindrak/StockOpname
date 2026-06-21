export function getDb(c) {
  const db = c.get("db");
  if (!db) throw new Error("Database service is not configured");
  return db;
}

export function getRealtime(c) {
  return c.get("realtime") || null;
}

export function getAuthSecret(c) {
  const secret = c.get("authSecret");
  if (!secret) throw new Error("JWT_SECRET is not configured");
  return secret;
}
