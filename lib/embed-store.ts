import { isEmbedOriginAllowed, validateEmbedOrigins } from "./embed-security";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { getConfig, setConfig } from "./store";
import { FlowError, getFlow } from "./flow-service";
import { currentTenant } from "./tenant-context";
import { assertJobLease } from "./saas-job-context";
import type { Sql } from "./saas-db";
import { and, eq } from "drizzle-orm";
import { embedSettings as settingsTable } from "./db/schema";
import type { Run } from "./flow-types";
import { appOrigin } from "./saas-security";
import { validCapabilities, type EmbedSettings, type PageCapability, type PageCommand } from "./embed-protocol";
export type EmbedIdentity = { flowId: string; subject: string; origin: string; exp: number; generation: string; preview?: boolean };
export type EmbedSession = { id: string; flowId: string; subject: string; origin: string; generation: string; preview?: boolean; tabId: string; runIds: string[]; capabilities: PageCapability[]; connectedAt: number; attachments: string[]; context: string; createdAt: number };
function allowedOrigin(settings: EmbedSettings, identity: Pick<EmbedIdentity, "origin" | "preview">) {
  return identity.preview === true ? identity.origin === appOrigin() : isEmbedOriginAllowed(settings.origins, identity.origin);
}
export async function embedSettings(flowId: string): Promise<EmbedSettings> {
  const flow = await getFlow(flowId), { db, user } = currentTenant();
  const rows = await db.orm.select({ body: settingsTable.body }).from(settingsTable).where(and(eq(settingsTable.user_id, user.id), eq(settingsTable.flow_id, flowId)));
  const saved = (rows[0]?.body || {}) as Partial<EmbedSettings>;
  return { displayMode: "detailed", enabled: true, origins: [], title: "Como podemos ajudar?", welcome: "Conte o que você gostaria de melhorar ou resolver.", maxMinutes: 15, maxCommands: 12, ...saved, agentName: typeof saved.agentName === "string" && saved.agentName.trim() ? saved.agentName : flow.name.trim() || "Assistente", avatarUrl: typeof saved.avatarUrl === "string" ? saved.avatarUrl : "" };
}
export async function saveEmbedSettings(flowId: string, value: EmbedSettings) {
  const flow = await getFlow(flowId), { db, user } = currentTenant();
  const agentName = value.agentName === undefined ? flow.name.trim() || "Assistente" : typeof value.agentName === "string" ? value.agentName.trim() : "";
  const avatarUrl = typeof value.avatarUrl === "string" ? value.avatarUrl.trim() : "";
  if (typeof value.enabled !== "boolean" || !Array.isArray(value.origins) || value.origins.length > 20 || !agentName || agentName.length > 80 || avatarUrl.length > 2048 || typeof value.title !== "string" || value.title.length > 80 || typeof value.welcome !== "string" || value.welcome.length > 500 || !Number.isInteger(value.maxMinutes) || value.maxMinutes < 1 || value.maxMinutes > 15 || !Number.isInteger(value.maxCommands) || value.maxCommands < 1 || value.maxCommands > 30) throw new FlowError("Confira os dados do chat: nome do agente, até 15 minutos e até 30 ações por tarefa.");
  if (avatarUrl) {
    try { const avatar = new URL(avatarUrl); if (avatar.protocol !== "https:" || avatar.username || avatar.password) throw new Error(); }
    catch { throw new FlowError("Informe um endereço HTTPS válido para o avatar."); }
  }
  if (value.displayMode !== undefined && !["detailed", "simple"].includes(value.displayMode)) throw new FlowError("Escolha uma visualização válida para o chat.");
  let origins: string[];
  try { origins = validateEmbedOrigins(value.origins); }
  catch (e) { throw new FlowError(e instanceof Error ? e.message : "Confira os sites autorizados."); }
  if (value.enabled && !(await getFlow(flowId)).published) throw new FlowError("Salve o fluxo no editor antes de configurar o chat.");
  const result = { enabled: value.enabled, title: value.title, welcome: value.welcome, maxMinutes: value.maxMinutes, maxCommands: value.maxCommands, agentName, avatarUrl, displayMode: value.displayMode ?? "detailed", origins };
  await db.orm.insert(settingsTable).values({ user_id: user.id, flow_id: flowId, body: result }).onConflictDoUpdate({ target: [settingsTable.user_id, settingsTable.flow_id], set: { body: result } });
  if (result.enabled && !hasEmbedKey(flowId)) await rotateEmbedKey(flowId);
  return result;
}
const keyName = (id: string) => "EMBED_KEY_" + id.replaceAll("-", "_");
export async function rotateEmbedKey(flowId: string) { await getFlow(flowId); const key = randomBytes(32).toString("base64url"); setConfig(keyName(flowId), key); return key; }
export function hasEmbedKey(flowId: string) { currentTenant(); return !!getConfig(keyName(flowId)); }
export function checkEmbedKey(flowId: string, key: string) {
  currentTenant();
  const expected = getConfig(keyName(flowId));
  if (!expected || !key || key.length > 256 || !timingSafeEqual(createHash("sha256").update(key).digest(), createHash("sha256").update(expected).digest())) throw new FlowError("Acesso não autorizado.", 401);
}
export async function issueEmbedTicket(flowId: string, subject: unknown, origin: unknown, preview = false) {
  const settings = await embedSettings(flowId), key = getConfig(keyName(flowId));
  if (!settings.enabled || !(await getFlow(flowId)).published || !key) throw new FlowError("O chat não está disponível.", 403);
  if (typeof subject !== "string" || !subject.trim() || subject.length > 200 || typeof origin !== "string" || !allowedOrigin(settings, { origin, preview })) throw new FlowError("Usuário ou site não autorizado.", 403);
  const identity: EmbedIdentity = { flowId, subject, origin, exp: Date.now() + 10 * 60_000, generation: createHash("sha256").update(key).digest("hex"), ...(preview ? { preview: true } : {}) };
  const payload = Buffer.from(JSON.stringify(identity)).toString("base64url");
  return { token: payload + "." + createHmac("sha256", key).update(payload).digest("base64url"), expiresAt: identity.exp };
}
// Parsing locates a database-owned flow; it does not authenticate a caller.
export function embedTokenPayload(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  try {
    if (token.length > 2000) throw 0;
    const [payload, signature, extra] = token.split(".");
    if (extra || !payload || !signature) throw 0;
    const identity = JSON.parse(Buffer.from(payload, "base64url").toString()) as EmbedIdentity;
    if (!/^[a-f0-9-]{36}$/.test(identity.flowId) || typeof identity.subject !== "string" || !identity.subject.trim() || identity.subject.length > 200 || typeof identity.origin !== "string" || !Number.isFinite(identity.exp) || identity.exp < Date.now() || identity.exp > Date.now() + 600000 || typeof identity.generation !== "string") throw 0;
    return { payload, signature, identity };
  } catch { throw new FlowError("Sua conexão expirou. Reconecte o chat.", 401); }
}
export async function authenticateEmbed(req: Request): Promise<EmbedIdentity> {
  try {
    const { payload, signature, identity } = embedTokenPayload(req);
    const key = getConfig(keyName(identity.flowId)); if (!key) throw 0;
    const expected = createHmac("sha256", key).update(payload).digest(), received = Buffer.from(signature, "base64url");
    if (received.length !== expected.length || !timingSafeEqual(expected, received) || identity.generation !== createHash("sha256").update(key).digest("hex")) throw 0;
    const settings = await embedSettings(identity.flowId);
    if (!settings.enabled || !allowedOrigin(settings, identity) || !(await getFlow(identity.flowId)).published) throw 0;
    return identity;
  } catch { throw new FlowError("Sua conexão expirou. Reconecte o chat.", 401); }
}
export async function readSession(sql: Sql, owner: string, id: string, lock = false): Promise<EmbedSession> {
  const { rows } = await sql.query<{ body: EmbedSession }>(`SELECT body FROM embed_sessions WHERE user_id=$1 AND id=$2 AND expires_at>now()${lock ? " FOR UPDATE" : ""}`, [owner, id]);
  if (!rows[0]) throw new FlowError("Conversa não encontrada ou expirada.", 404);
  const requests = await sql.query<{ run_id: string }>("SELECT run_id FROM embed_requests WHERE user_id=$1 AND session_id=$2 ORDER BY created_at,run_id", [owner, id]);
  return { ...rows[0].body, runIds: requests.rows.map(row => row.run_id) };
}
export async function getSession(id: string) { const { db, user } = currentTenant(); return readSession(db, user.id, id); }
export function assertSessionIdentity(session: EmbedSession, identity: EmbedIdentity) {
  if (session.flowId !== identity.flowId || session.subject !== identity.subject || session.origin !== identity.origin || session.generation !== identity.generation || !!session.preview !== !!identity.preview) throw new FlowError("Conversa não encontrada.", 404);
}
export async function ownedSession(id: string, identity: EmbedIdentity) { const session = await getSession(id); assertSessionIdentity(session, identity); return session; }
export async function sessionHasAttachment(session: EmbedSession, id: string) {
  if (session.attachments.includes(id)) return true;
  const { db, user } = currentTenant();
  const { rows } = await db.query(`SELECT 1 FROM runs r JOIN embed_requests e ON r.user_id=e.user_id AND r.id=e.run_id
    WHERE e.user_id=$1 AND e.session_id=$2 AND r.body @> jsonb_build_object('trace',jsonb_build_array(jsonb_build_object('images',jsonb_build_array(jsonb_build_object('id',$3::text))))) LIMIT 1`, [user.id, session.id, id]);
  return !!rows.length;
}
export async function updateSession(id: string, change: (session: EmbedSession) => void) {
  const { db, user } = currentTenant();
  return db.transaction(async sql => {
    await assertJobLease(sql, user.id);
    await sql.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [user.id]);
    const session = await readSession(sql, user.id, id, true);
    change(session);
    await sql.query("UPDATE embed_sessions SET body=$3 WHERE user_id=$1 AND id=$2", [user.id, id, JSON.stringify({ ...session, runIds: [] })]);
    return session;
  });
}
export async function connectSession(identity: EmbedIdentity, id: unknown, tabId: unknown, capabilities: unknown) {
  if (typeof tabId !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(tabId)) throw new FlowError("Identificação da aba inválida.");
  let allowed: PageCapability[];
  try { allowed = validCapabilities(capabilities); } catch (error) { throw new FlowError((error as Error).message); }
  if (typeof id === "string" && id) return updateSession(id, session => {
    assertSessionIdentity(session, identity);
    if (session.tabId !== tabId) throw new FlowError("Esta conversa está vinculada a outra aba. Inicie uma nova conversa.", 409);
    session.capabilities = allowed; session.connectedAt = Date.now();
  });
  const { db, user } = currentTenant();
  const session: EmbedSession = { id: randomUUID(), flowId: identity.flowId, subject: identity.subject, origin: identity.origin, generation: identity.generation, ...(identity.preview ? { preview: true } : {}), tabId, runIds: [], capabilities: allowed, connectedAt: Date.now(), attachments: [], context: "", createdAt: Date.now() };
  await db.transaction(async sql => {
    await sql.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [user.id]);
    await sql.query("DELETE FROM embed_sessions WHERE user_id=$1 AND expires_at<=now()", [user.id]);
    if ((await sql.query<{ n: number }>("SELECT count(*)::int n FROM embed_sessions WHERE user_id=$1", [user.id])).rows[0].n >= 500) throw new FlowError("Limite de conversas da conta atingido. Aguarde a expiração de conversas antigas.", 429);
    await sql.query("INSERT INTO embed_sessions(user_id,id,flow_id,body,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 day')", [user.id, session.id, session.flowId, JSON.stringify(session)]);
  });
  return session;
}
export async function requestRun(sessionId: string, requestId: string) {
  const { db, user } = currentTenant();
  return (await db.query<{ run_id: string }>("SELECT run_id FROM embed_requests WHERE user_id=$1 AND session_id=$2 AND request_id=$3", [user.id, sessionId, requestId])).rows[0]?.run_id;
}
export async function commands(sessionId: string, runId?: string, activeOnly = false): Promise<PageCommand[]> {
  const { db, user } = currentTenant();
  return (await db.query<{ body: PageCommand }>(`SELECT body FROM embed_commands WHERE user_id=$1 AND session_id=$2${runId ? " AND run_id=$3" : ""}${activeOnly ? " AND status IN ('pending','delivered')" : ""} ORDER BY created_at DESC,id DESC LIMIT 100`, [user.id, sessionId, ...(runId ? [runId] : [])])).rows.map(row => row.body);
}
export async function assertEmbedRun(run: Run) {
  if (!run.embedSessionId) return;
  const session = await getSession(run.embedSessionId), key = getConfig(keyName(run.flowId));
  const settings = await embedSettings(run.flowId);
  if (!key || session.flowId !== run.flowId || !session.runIds.includes(run.id) || session.generation !== createHash("sha256").update(key).digest("hex") || !settings.enabled || !allowedOrigin(settings, session) || !(await getFlow(run.flowId)).published)
    throw new FlowError("A autorização desta conversa foi revogada. Reconecte o chat.", 403);
}
export async function command(id: string): Promise<PageCommand> {
  const { db, user } = currentTenant();
  const row = (await db.query<{ body: PageCommand }>("SELECT body FROM embed_commands WHERE user_id=$1 AND id=$2", [user.id, id])).rows[0];
  if (!row) throw new FlowError("Solicitação não encontrada.", 404);
  return row.body;
}
export async function createCommand(value: PageCommand, maxCommands: number) {
  const { db, user } = currentTenant();
  return db.transaction(async sql => {
    await assertJobLease(sql, user.id);
    await sql.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [user.id]);
    const session = await readSession(sql, user.id, value.sessionId, true);
    if (!session.runIds.includes(value.runId) || Date.now() - session.connectedAt > 30000 || !session.capabilities.some(cap => cap.name === value.name)) throw new FlowError("A página desconectou ou a ação não está autorizada.", 409);
    const previous = await sql.query<{ body: PageCommand }>("SELECT body FROM embed_commands WHERE user_id=$1 AND run_id=$2", [user.id, value.runId]);
    if (previous.rows.length >= maxCommands) throw new FlowError("Limite de ações na página atingido.");
    if (previous.rows.some(({ body }) => ["pending", "delivered"].includes(body.status))) throw new FlowError("Aguarde a resposta da ação já solicitada antes de pedir outra.", 409);
    await sql.query("INSERT INTO embed_commands(user_id,id,session_id,run_id,status,body) VALUES($1,$2,$3,$4,$5,$6)", [user.id, value.id, value.sessionId, value.runId, value.status, JSON.stringify(value)]);
    return value;
  });
}
export async function closeCommand(id: string, status: "expired" | "cancelled") {
  const { db, user } = currentTenant();
  await db.query("UPDATE embed_commands SET status=$3,body=body || jsonb_build_object('status',$3::text) WHERE user_id=$1 AND id=$2 AND status IN ('pending','delivered')", [user.id, id, status]);
}
export async function settleCommand(sessionId: string, id: string, action: "claim" | "result", result?: unknown, success = true) {
  const { db, user } = currentTenant();
  return db.transaction(async sql => {
    const found = (await sql.query<{ run_id: string }>("SELECT run_id FROM embed_commands WHERE user_id=$1 AND id=$2 AND session_id=$3", [user.id, id, sessionId])).rows[0];
    if (!found) throw new FlowError("Solicitação não encontrada.", 404);
    // Cancellation and recovery lock the run before its commands too.
    const run = (await sql.query<{ status: string }>("SELECT status FROM runs WHERE user_id=$1 AND id=$2 FOR UPDATE", [user.id, found.run_id])).rows[0];
    const { rows } = await sql.query<{ body: PageCommand }>("SELECT body FROM embed_commands WHERE user_id=$1 AND id=$2 AND session_id=$3 FOR UPDATE", [user.id, id, sessionId]);
    const value = rows[0]?.body;
    if (!value) throw new FlowError("Solicitação não encontrada.", 404);
    if (run?.status !== "running" || value.expiresAt <= Date.now()) throw new FlowError("Esta solicitação não está mais ativa.", 409);
    if (action === "claim") {
      if (value.status !== "pending") throw new FlowError("Solicitação já recebida. Não repita a ação.", 409);
      value.status = "delivered";
    } else {
      if (value.status !== "delivered") throw new FlowError("Solicitação já respondida ou não recebida.", 409);
      const text = JSON.stringify(result ?? null);
      if (text.length > 16000) throw new FlowError("A resposta da página excedeu o limite.");
      value.result = text; value.status = success ? "completed" : "failed";
    }
    await sql.query("UPDATE embed_commands SET status=$3,body=$4 WHERE user_id=$1 AND id=$2", [user.id, id, value.status, JSON.stringify(value)]);
    return value;
  });
}
export async function cancelCommands(runId: string) {
  const { db, user } = currentTenant();
  await db.query("UPDATE embed_commands SET status='cancelled',body=body || '{\"status\":\"cancelled\"}'::jsonb WHERE user_id=$1 AND run_id=$2 AND status IN ('pending','delivered')", [user.id, runId]);
}
