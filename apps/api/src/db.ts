import pg, { type PoolClient, type QueryResultRow } from "pg";
import { config } from "./config.js";

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: Number(process.env.DATABASE_POOL_MAX || 12),
  // The architecture doc promises TLS to PostgreSQL; nothing previously enforced it.
  ssl: config.databaseSsl ? { rejectUnauthorized: true } : undefined,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
});

export async function query<T extends QueryResultRow>(sql: string, values: unknown[] = []) {
  return pool.query<T>(sql, values);
}

export async function transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function databaseReachable(): Promise<boolean> {
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  }
}
