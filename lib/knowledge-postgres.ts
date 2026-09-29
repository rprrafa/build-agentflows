import type { PostgresConnection } from "./knowledge-types";
import { resolvePostgresCredential } from "./tool-credential-store";
import { FlowError } from "./flow-store";

export function validatedPostgres(input: PostgresConnection): PostgresConnection {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
    typeof input.host !== "string" || !/^(\[[a-fA-F0-9:]+\]|[a-zA-Z0-9.-]+)$/.test(input.host) || input.host.length > 253 ||
    typeof input.database !== "string" || !input.database.trim() || input.database.length > 100 ||
    !Number.isInteger(input.port) || input.port < 1 || input.port > 65535 ||
    typeof input.ssl !== "boolean" || typeof input.credentialId !== "string" || !input.credentialId)
    throw new FlowError("Preencha host, banco, porta e credencial do PostgreSQL.");
  const connectionTimeout = input.connectionTimeout ?? 10000, queryTimeout = input.queryTimeout ?? 120000;
  if (![connectionTimeout, queryTimeout].every(n => Number.isInteger(n) && n >= 1000 && n <= 600000))
    throw new FlowError("Use tempos limite entre 1 e 600 segundos.");
  resolvePostgresCredential(input.credentialId);
  return { host: input.host, database: input.database.trim(), port: input.port, ssl: input.ssl, credentialId: input.credentialId, connectionTimeout, queryTimeout };
}

export function postgresConnectionString(input: PostgresConnection) {
  const c = validatedPostgres(input);
  const { user, password } = resolvePostgresCredential(c.credentialId);
  const url = new URL(`postgresql://${c.host}:${c.port}/`);
  url.username = user;
  url.password = password;
  url.pathname = `/${encodeURIComponent(c.database)}`;
  url.searchParams.set("sslmode", c.ssl ? "verify-full" : "disable");
  return url.href;
}

/** Keep the generation's destination, but pick up password rotation when its credential still exists. */
export function currentPostgresConnection(config: { postgres?: PostgresConnection; connectionString?: string }): string {
  if (config.postgres) {
    try { return postgresConnectionString(config.postgres); }
    catch (error) {
      // A detached credential may have been deleted after changing the base's destination.
      if (!(error instanceof FlowError) || error.status !== 404 || !config.connectionString) throw error;
    }
  }
  if (!config.connectionString) throw new FlowError("Configure a conexão PostgreSQL.");
  return config.connectionString;
}
