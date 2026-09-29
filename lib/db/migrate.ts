import { readMigrationFiles } from "drizzle-orm/migrator";
import path from "node:path";
import type { Database } from "../saas-db";

/** Apply Drizzle-generated SQL under one deploy lock and transaction. */
export async function migrateDatabase(db: Database) {
  const migrations = readMigrationFiles({ migrationsFolder: path.join(process.cwd(), "drizzle") });
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(742193801)");
    await tx.query("CREATE TABLE IF NOT EXISTS __drizzle_migrations(id serial PRIMARY KEY,hash text NOT NULL,created_at bigint NOT NULL)");
    const { rows } = await tx.query<{ hash: string; created_at: string }>("SELECT hash,created_at FROM __drizzle_migrations ORDER BY created_at");
    for (const migration of migrations) {
      const previous = rows.find((row) => Number(row.created_at) === migration.folderMillis);
      if (previous) {
        if (previous.hash !== migration.hash) throw new Error("Uma migração aplicada foi alterada. Crie uma nova migração.");
        continue;
      }
      for (const statement of migration.sql) if (statement.trim()) await tx.query(statement);
      await tx.query("INSERT INTO __drizzle_migrations(hash,created_at) VALUES($1,$2)", [migration.hash, migration.folderMillis]);
    }
  });
}
