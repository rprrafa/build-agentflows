import { saasDatabase, type Database } from "./saas-db";
import { withTenantJob, currentTenant } from "./tenant-context";
import { FlowError } from "./flow-store";
import { appOrigin } from "./saas-security";
import { httpError, privateJson } from "./saas-http";
import { consumeRateLimit, rateLimitClient } from "./saas-rate-limit";
import { authenticateEmbed, embedTokenPayload, type EmbedIdentity } from "./embed-store";

export async function withEmbedOwner<T>(flowId: string, action: () => Promise<T>, db: Database = saasDatabase()) {
  if (!/^[a-f0-9-]{36}$/.test(flowId)) throw new FlowError("Chat não encontrado.", 404);
  const { rows } = await db.query<{ user_id: string }>("SELECT user_id FROM flows WHERE id=$1 LIMIT 2", [flowId]);
  // Public addresses do not accept an owner parameter. Ambiguous IDs fail closed.
  if (rows.length !== 1) throw new FlowError("Chat não encontrado.", 404);
  return withTenantJob(db, rows[0].user_id, action);
}
export async function embedOwnerApi(req: Request, flowId: string, action: () => Promise<unknown>) {
  try {
    if (req.headers.get("origin") && req.headers.get("origin") !== appOrigin()) throw new FlowError("Origem da requisição inválida.", 403);
    const db = saasDatabase();
    await consumeRateLimit(db, `embed:ip:${rateLimitClient(req.headers)}`, 180, 60);
    return await withEmbedOwner(flowId, async () => {
      const result = await action();
      return result instanceof Response ? result : privateJson(result);
    }, db);
  } catch (error) { return httpError(error); }
}
export async function embedApi(req: Request, action: (identity: EmbedIdentity) => Promise<unknown>) {
  try {
    const { identity } = embedTokenPayload(req);
    return embedOwnerApi(req, identity.flowId, async () => {
      const authenticated = await authenticateEmbed(req), { db, user } = currentTenant();
      await consumeRateLimit(db, `embed:user:${user.id}`, 600, 60);
      return action(authenticated);
    });
  } catch (error) { return httpError(error); }
}
