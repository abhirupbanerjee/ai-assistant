import { initialMigration } from "../../db/migrations/001_initial";
import { getPool } from "./pool";

const migrations = [initialMigration] as const;
let migrationPromise: Promise<void> | undefined;

export function runMigrations(): Promise<void> {
  migrationPromise ??= migrate();
  return migrationPromise;
}

async function migrate(): Promise<void> {
  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [821_704_219]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS portal_schema_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const appliedResult = await client.query<{ id: string }>("SELECT id FROM portal_schema_migrations");
    const applied = new Set(appliedResult.rows.map(({ id }) => id));
    for (const migration of migrations) {
      if (applied.has(migration.id)) continue;
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query("INSERT INTO portal_schema_migrations (id) VALUES ($1)", [migration.id]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [821_704_219]).catch(() => undefined);
    client.release();
  }
}

export async function checkDatabaseReadiness(): Promise<void> {
  await runMigrations();
  const pool = await getPool();
  await pool.query("SELECT 1");
}
