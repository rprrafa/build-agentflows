import { randomBytes, randomUUID } from "node:crypto";
import { createTestDatabase } from "./saas-test-db";
import { withDatabase } from "../lib/saas-db";
import { migrateDatabase } from "../lib/db/migrate";
import { hashToken, randomToken } from "../lib/saas-security";
import { withTenantSession } from "../lib/tenant-context";

/** Real session and isolated database for the actual HTTP handlers, with no auth bypass. */
export async function createTenantTestContext() {
  const database = await createTestDatabase();
  const db = { ...database.db, close: database.close };
  process.env.CHAVE_MESTRA ||= randomBytes(32).toString("base64");
  process.env.APP_URL = "https://app.example.com";
  await migrateDatabase(db);
  const owner = randomUUID(), token = randomToken();
  await db.orm.insert((await import("../lib/db/schema")).users).values({ id: owner, name: "Test user", email: `${owner}@example.com`, email_verified_at: new Date().toISOString(), beta_status: "approved" });
  await db.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')", [hashToken(token), owner]);
  return {
    db, owner, token, close: database.close,
    asTenant: <T>(action: () => T | Promise<T>) => withTenantSession(db, token, action),
    connect: <T>(action: () => T) => withDatabase(db, action),
    request(pathname: string, init: RequestInit = {}) {
      const headers = new Headers(init.headers);
      headers.set("cookie", `agentflows_session=${token}`);
      headers.set("origin", process.env.APP_URL!);
      if (init.body && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
      return new Request(new URL(pathname, process.env.APP_URL), { ...init, headers });
    },
  };
}

/** Commit a fixture's configuration like an HTTP boundary before its next operation. */
export async function commitTestConfig() {
  const { currentTenant } = await import("../lib/tenant-context");
  const { commitConfigState, loadConfigState } = await import("../lib/tenant-config-state");
  const { db, user, config } = currentTenant();
  try { await commitConfigState(db, user.id, config); }
  finally { Object.assign(config, await loadConfigState(db, user.id)); }
}
