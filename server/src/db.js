import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Check server/.env");
}

export const pool = new Pool({ connectionString });

// A single dedicated client used for LISTEN so notifications survive across requests.
let listenClient = null;
export async function getListenClient() {
  if (listenClient) return listenClient;
  listenClient = new pg.Client({ connectionString });
  await listenClient.connect();
  return listenClient;
}

export async function query(text, params) {
  return pool.query(text, params);
}
