import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
const pool = new pg.Pool({ connectionString });
await pool.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
for (const name of (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort()) {
  const exists = await pool.query("select 1 from schema_migrations where name = $1", [name]);
  if (exists.rowCount) continue;
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(await readFile(path.join(directory, name), "utf8"));
    await client.query("insert into schema_migrations(name) values ($1)", [name]);
    await client.query("commit");
    process.stdout.write(`Applied ${name}\n`);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
await pool.end();
