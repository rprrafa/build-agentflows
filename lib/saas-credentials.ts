import type { Sql } from "./saas-db";
import { seal, unseal } from "./saas-security";
import { and, eq, sql as expression } from "drizzle-orm";
import { credentials } from "./db/schema";

// The owner must come from the validated session/job, never from JSON supplied by the client.
export function credentialsFor(sql: Sql, userId: string) {
  if (!/^[a-f0-9-]{36}$/i.test(userId)) throw new Error("Usuário inválido.");
  function context(key: string) {
    if (!key || key.length > 200) throw new Error("Chave de credencial inválida.");
    return `credential:${userId}:${key}`;
  }
  return {
    async get(key: string) {
      const aad = context(key);
      const rows = await sql.orm.select({ ciphertext: credentials.ciphertext }).from(credentials).where(and(eq(credentials.user_id, userId), eq(credentials.key, key))).limit(1);
      return rows[0] ? unseal(rows[0].ciphertext, aad) : undefined;
    },
    async set(key: string, value: string | null) {
      const aad = context(key);
      if (value === null || value === "") {
        await sql.orm.delete(credentials).where(and(eq(credentials.user_id, userId), eq(credentials.key, key)));
      } else {
        const ciphertext = seal(value, aad);
        await sql.orm.insert(credentials).values({ user_id: userId, key, ciphertext }).onConflictDoUpdate({ target: [credentials.user_id, credentials.key], set: { ciphertext, updated_at: expression`now()` } });
      }
    },
  };
}
