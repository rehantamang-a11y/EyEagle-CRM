import pg, { type PoolClient, type QueryResultRow } from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 12 });

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
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
