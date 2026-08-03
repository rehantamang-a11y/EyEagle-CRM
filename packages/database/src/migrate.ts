import crypto from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
const pool = new pg.Pool({
  connectionString,
  ssl: process.env.NODE_ENV === "production" && process.env.DATABASE_SSL !== "false"
    ? { rejectUnauthorized: true }
    : undefined,
});

await pool.query(`
  create table if not exists schema_migrations (
    name text primary key,
    checksum text,
    applied_at timestamptz not null default now()
  )`);
await pool.query("alter table schema_migrations add column if not exists checksum text");

/*
 * Two deploys running concurrently would previously both start migrating. The
 * advisory lock serialises them; the second waits and then finds nothing to do.
 */
const lock = await pool.connect();
await lock.query("select pg_advisory_lock(hashtext('eyeagle_crm_migrations'))");

try {
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();

  for (const name of files) {
    const sql = await readFile(path.join(directory, name), "utf8");
    const checksum = crypto.createHash("sha256").update(sql).digest("hex");

    const existing = await pool.query<{ checksum: string | null }>(
      "select checksum from schema_migrations where name = $1",
      [name],
    );
    if (existing.rowCount) {
      // An edited migration means the deployed schema no longer matches the repo.
      if (existing.rows[0].checksum && existing.rows[0].checksum !== checksum) {
        throw new Error(`Migration ${name} has changed since it was applied. Add a new migration instead.`);
      }
      if (!existing.rows[0].checksum) {
        await pool.query("update schema_migrations set checksum = $2 where name = $1", [name, checksum]);
      }
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (name, checksum) values ($1, $2)", [name, checksum]);
      await client.query("commit");
      process.stdout.write(`Applied ${name}\n`);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await lock.query("select pg_advisory_unlock(hashtext('eyeagle_crm_migrations'))").catch(() => undefined);
  lock.release();
  await pool.end();
}
