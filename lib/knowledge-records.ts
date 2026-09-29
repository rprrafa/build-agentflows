import { currentPostgresConnection } from "./knowledge-postgres";
import type { IndexConfig } from "./knowledge-types";
import { sqlIdentifier } from "./knowledge-config";
import { withKnowledgePostgres } from "./knowledge-database";
import { FlowError } from "./flow-store";
import { tenantId } from "./tenant-context";
type RecordConfig = IndexConfig["recordManager"];
export type ManagedRecord = {
  hash: string;
  chunkId: string;
  sourceId: string;
  vector: number[];
};
function table(config: RecordConfig) {
  return `"${sqlIdentifier(config.tableName || "agentflows_records")}"`;
}
function namespace(config: RecordConfig) {
  const owner = tenantId();
  return `${owner ? `${owner}:` : ""}${config.namespace || "agentflows"}`;
}
export async function readManagedRecords(
  config: RecordConfig,
  baseId: string,
  generation: string,
  signal?: AbortSignal,
) {
  if (!config.connectionString)
    throw new FlowError("Configure a conexão do Record Manager.");
  return withKnowledgePostgres(
    currentPostgresConnection(config),
    async (client) => {
      const exists = await client.query("SELECT to_regclass($1) AS name", [
        table(config),
      ]);
      if (!exists.rows[0].name) return new Map<string, number[]>();
      const rows = await client.query(
        `SELECT hash, vector FROM ${table(config)} WHERE namespace=$1 AND base_id=$2 AND generation=$3`,
        [namespace(config), baseId, generation],
      );
      return new Map<string, number[]>(
        rows.rows.map((row) => [row.hash, row.vector]),
      );
    },
    signal,
    config.postgres,
  );
}
export async function writeManagedRecords(
  config: RecordConfig,
  baseId: string,
  generation: string,
  records: ManagedRecord[],
  signal?: AbortSignal,
) {
  if (!config.connectionString)
    throw new FlowError("Configure a conexão do Record Manager.");
  await withKnowledgePostgres(
    currentPostgresConnection(config),
    async (client) => {
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${table(config)} (namespace text NOT NULL,base_id text NOT NULL,generation text NOT NULL,chunk_id text NOT NULL,source_id text NOT NULL,hash text NOT NULL,vector jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(namespace,base_id,generation,chunk_id))`,
      );
      await client.query("BEGIN");
      try {
        for (const record of records) {
          signal?.throwIfAborted();
          await client.query(
            `INSERT INTO ${table(config)} (namespace,base_id,generation,chunk_id,source_id,hash,vector) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(namespace,base_id,generation,chunk_id) DO UPDATE SET hash=excluded.hash,vector=excluded.vector,updated_at=now()`,
            [
              namespace(config),
              baseId,
              generation,
              record.chunkId,
              record.sourceId,
              record.hash,
              JSON.stringify(record.vector),
            ],
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      }
    },
    signal,
    config.postgres,
  );
}
export async function deleteManagedRecords(
  config: RecordConfig,
  baseId: string,
  generation: string,
  sourceId?: string,
) {
  if (!config.connectionString)
    throw new FlowError(
      "Configure a conexão do Record Manager para concluir a limpeza.",
    );
  await withKnowledgePostgres(currentPostgresConnection(config), async (client) => {
    const exists = await client.query("SELECT to_regclass($1) AS name", [
      table(config),
    ]);
    if (!exists.rows[0].name) return;
    await client.query(
      `DELETE FROM ${table(config)} WHERE namespace=$1 AND base_id=$2 AND generation=$3${sourceId ? " AND source_id=$4" : ""}`,
      [namespace(config), baseId, generation, ...(sourceId ? [sourceId] : [])],
    );
  }, undefined, config.postgres);
}
