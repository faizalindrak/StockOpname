import bcrypt from "bcryptjs";
import { getAuthSecret } from "./requestServices.js";
import { signWorkerToken, verifyWorkerToken } from "./workerAuth.js";

export const DEFAULT_JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === "production" ? null : "dev-secret-change-me");
if (!DEFAULT_JWT_SECRET) {
  throw new Error("JWT_SECRET must be set in production");
}

export function signToken(payload, secret = DEFAULT_JWT_SECRET) {
  return signWorkerToken(payload, secret);
}

export async function verifyToken(token, secret = DEFAULT_JWT_SECRET) {
  return verifyWorkerToken(token, secret);
}

export async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

export async function checkPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

export async function authMiddleware(c, next) {
  const header = c.req.header("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return c.json({ error: "Missing bearer token" }, 401);
  }
  const payload = await verifyToken(token, getAuthSecret(c));
  if (!payload) {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
  c.set("user", payload);
  await next();
}
