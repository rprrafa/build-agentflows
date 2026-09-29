import type { Database, Sql } from "./saas-db";
import { AuthError, seal, unseal } from "./saas-security";
import { assertJobLease } from "./saas-job-context";

export type ConfigState = {
  values: Map<string, string>;
  originals: Map<string, string>;
  dirty: Set<string>;
  guards: ((sql: Sql) => Promise<void>)[];
};
const MAX_KEYS = 1000;
const MAX_BYTES = 4 * 1024 * 1024;
export async function loadConfigState(sql: Sql, owner: string): Promise<ConfigState> {
  const size = await sql.query<{ count: number; bytes: number }>("SELECT count(*)::int AS count,coalesce(sum(octet_length(ciphertext)),0)::int AS bytes FROM credentials WHERE user_id=$1", [owner]);
  if (size.rows[0].count > MAX_KEYS || size.rows[0].bytes > MAX_BYTES * 2) throw new AuthError("O espaço de configurações atingiu o limite.", 413);
  const { rows } = await sql.query<{ key: string; ciphertext: string }>("SELECT key,ciphertext FROM credentials WHERE user_id=$1 ORDER BY key LIMIT 1001", [owner]);
  if (rows.length > MAX_KEYS) throw new AuthError("O espaço de configurações atingiu o limite.", 413);
  return {
    values: new Map(rows.map((row) => [row.key, unseal(row.ciphertext, `credential:${owner}:${row.key}`)])),
    originals: new Map(rows.map((row) => [row.key, row.ciphertext])), dirty: new Set(), guards: [],
  };
}
export function stageConfig(state: ConfigState, key: string, value: string | null | undefined) {
  if (!key || key.length > 200) throw new AuthError("Chave de configuração inválida.");
  const normalized = value?.trim() || undefined;
  if (normalized !== undefined && Buffer.byteLength(normalized) > 256 * 1024) throw new AuthError("Configuração muito grande.", 413);
  if (normalized === state.values.get(key)) return;
  const values = new Map(state.values);
  if (normalized === undefined) values.delete(key); else values.set(key, normalized);
  if (values.size > MAX_KEYS || [...values.values()].reduce((sum, item) => sum + Buffer.byteLength(item), 0) > MAX_BYTES) throw new AuthError("O espaço de configurações atingiu o limite.", 413);
  state.values = values;
  state.dirty.add(key);
}

export async function writeConfigState(sql: Sql, owner: string, state: ConfigState) {
  for (const key of [...state.dirty].sort()) {
    const before = state.originals.get(key);
    const after = state.values.get(key);
    // Updating another key never overwrites a concurrent operation's work.
    if (before === undefined && after === undefined) continue;
    const next = after === undefined ? undefined : seal(after, `credential:${owner}:${key}`);
    let changed;
    if (before === undefined) {
      changed = await sql.query("INSERT INTO credentials(user_id,key,ciphertext) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING key", [owner, key, next]);
    } else if (next === undefined) {
      changed = await sql.query("DELETE FROM credentials WHERE user_id=$1 AND key=$2 AND ciphertext=$3 RETURNING key", [owner, key, before]);
    } else {
      changed = await sql.query("UPDATE credentials SET ciphertext=$4,updated_at=now() WHERE user_id=$1 AND key=$2 AND ciphertext=$3 RETURNING key", [owner, key, before, next]);
    }
    if (!changed.rows.length) throw new AuthError("A configuração mudou em outra operação. Atualize a página e tente novamente.", 409);
  }
}

export async function commitConfigState(db: Database, owner: string, state: ConfigState) {
  if (!state.dirty.size) return;
  await db.transaction(async (sql) => {
    await assertJobLease(sql, owner);
    // Keep quota checking and writes atomic even when new keys are created concurrently.
    const user = await sql.query("SELECT id FROM users WHERE id=$1 AND beta_status='approved' AND email_verified_at IS NOT NULL FOR UPDATE", [owner]);
    if (!user.rows.length) throw new AuthError("Acesso ao beta pendente ou suspenso.", 403);
    for (const guard of state.guards) await guard(sql);
    await writeConfigState(sql, owner, state);
    const { rows } = await sql.query<{ count: number; bytes: number }>("SELECT count(*)::int AS count,coalesce(sum(octet_length(ciphertext)),0)::int AS bytes FROM credentials WHERE user_id=$1", [owner]);
    if (rows[0].count > MAX_KEYS || rows[0].bytes > MAX_BYTES * 2) throw new AuthError("O espaço de configurações atingiu o limite.", 413);
  });
  state.dirty.clear();
}
