import { Pool, type QueryResultRow } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./db/schema";
import { AsyncLocalStorage } from "node:async_hooks";

export type Orm = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface Sql {
  orm: Orm;
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
}
export interface Database extends Sql {
  transaction<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
}

type Connection = Database & { close(): Promise<void> };
let instance: Connection | undefined;
const connections = new AsyncLocalStorage<Connection>();

/** Explicit dependency scope for integration tests and controlled background work. */
export function withDatabase<T>(db: Connection, action: () => T): T { return connections.run(db, action); }

/** A bounded pool per process; web and workers use the same authoritative database. */
export function saasDatabase() {
  const scoped = connections.getStore();
  if (scoped) return scoped;
  if (instance) return instance;
  if (!process.env.DATABASE_URL) throw new Error("Configure DATABASE_URL para o PostgreSQL.");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 15000,
    idle_in_transaction_session_timeout: 15000,
  });
  // Do not log a connection URL, SQL parameters or provider secrets.
  pool.on("error", () => console.error("Conexão ociosa com PostgreSQL interrompida."));
  instance = {
    orm: drizzle(pool, { schema }),
    query: (text, values) => pool.query(text, values),
    async transaction(fn) {
      const client = await pool.connect();
      let broken = false;
      try {
        await client.query("BEGIN");
        const result = await fn({ query: (text, values) => client.query(text, values), orm: drizzle(client, { schema }) });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch { broken = true; }
        throw error;
      } finally { client.release(broken); }
    },
    async close() { await pool.end(); instance = undefined; },
  };
  return instance;
}
