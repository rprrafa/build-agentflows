import { isEmbedOriginAllowed, validateEmbedOrigins } from "./embed-security";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { abrirBanco, getConfig, setConfig } from "./store";
import { FlowError, getFlow, getRun } from "./flow-store";
import { validCapabilities, type EmbedSettings, type PageCapability, type PageCommand } from "./embed-protocol";
export type EmbedIdentity = { flowId: string; subject: string; origin: string; exp: number; generation: string };
export type EmbedSession = { id: string; flowId: string; subject: string; origin: string; tabId: string; runIds: string[]; capabilities: PageCapability[]; connectedAt: number; attachments: string[]; context: string; createdAt: number };
function db() {
  const d = abrirBanco();
  d.exec(`CREATE TABLE IF NOT EXISTS embed_settings (flow_id TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS embed_sessions (id TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS embed_commands (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, run_id TEXT NOT NULL, body TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS embed_commands_run ON embed_commands(run_id);
    CREATE TABLE IF NOT EXISTS embed_requests (session_id TEXT NOT NULL, request_id TEXT NOT NULL, run_id TEXT NOT NULL, PRIMARY KEY(session_id,request_id));`);
  return d;
}
export function embedSettings(flowId: string): EmbedSettings {
  const flow = getFlow(flowId);
  const row = db().prepare("SELECT body FROM embed_settings WHERE flow_id=?").get(flowId) as { body: string } | undefined;
  const saved = row ? JSON.parse(row.body) : {};
  return { displayMode: "detailed", enabled: true, origins: [], title: "Como podemos ajudar?", welcome: "Conte o que você gostaria de melhorar ou resolver.", maxMinutes: 30, maxCommands: 12, ...saved, agentName: typeof saved.agentName === "string" && saved.agentName.trim() ? saved.agentName : flow.name.trim() || "Assistente", avatarUrl: typeof saved.avatarUrl === "string" ? saved.avatarUrl : "" };
}
export function saveEmbedSettings(flowId: string, value: EmbedSettings) {
  const flow = getFlow(flowId);
  const agentName = value.agentName === undefined ? flow.name.trim() || "Assistente" : typeof value.agentName === "string" ? value.agentName.trim() : "";
  const avatarUrl = typeof value.avatarUrl === "string" ? value.avatarUrl.trim() : "";
  if (typeof value.enabled !== "boolean" || !Array.isArray(value.origins) || value.origins.length > 20 || !agentName || agentName.length > 80 || avatarUrl.length > 2048 || typeof value.title !== "string" || value.title.length > 80 || typeof value.welcome !== "string" || value.welcome.length > 500 || !Number.isInteger(value.maxMinutes) || value.maxMinutes < 1 || value.maxMinutes > 60 || !Number.isInteger(value.maxCommands) || value.maxCommands < 1 || value.maxCommands > 30) throw new FlowError("Confira os dados do chat e informe o nome do agente.");
  if (avatarUrl) {
    try { const avatar = new URL(avatarUrl); if (avatar.protocol !== "https:" || avatar.username || avatar.password) throw new Error(); }
    catch { throw new FlowError("Informe um endereço HTTPS válido para o avatar."); }
  }
  if (value.displayMode !== undefined && !["detailed", "simple"].includes(value.displayMode)) throw new FlowError("Escolha uma visualização válida para o chat.");
  let origins: string[];
  try { origins = validateEmbedOrigins(value.origins); }
  catch (e) { throw new FlowError(e instanceof Error ? e.message : "Confira os sites autorizados."); }
  if (value.enabled && !getFlow(flowId).published) throw new FlowError("Salve o fluxo no editor antes de configurar o chat.");
  const result = { ...value, agentName, avatarUrl, displayMode: value.displayMode ?? "detailed", origins };
  db().prepare("INSERT INTO embed_settings VALUES(?,?) ON CONFLICT(flow_id) DO UPDATE SET body=excluded.body").run(flowId, JSON.stringify(result));
  if (result.enabled && !hasEmbedKey(flowId)) rotateEmbedKey(flowId);
  return result;
}
const keyName = (id: string) => "EMBED_KEY_" + id.replaceAll("-", "_");
export function rotateEmbedKey(flowId: string) { getFlow(flowId); const key = randomBytes(32).toString("base64url"); setConfig(keyName(flowId), key); return key; }
export function hasEmbedKey(flowId: string) { return !!getConfig(keyName(flowId)); }
export function checkEmbedKey(flowId: string, key: string) {
  const expected = getConfig(keyName(flowId));
  if (!expected || !key || !timingSafeEqual(createHash("sha256").update(key).digest(), createHash("sha256").update(expected).digest())) throw new FlowError("Acesso não autorizado.", 401);
}
export function issueEmbedTicket(flowId: string, subject: unknown, origin: unknown) {
  const settings = embedSettings(flowId), key = getConfig(keyName(flowId));
  if (!settings.enabled || !getFlow(flowId).published || !key) throw new FlowError("O chat não está disponível.", 403);
  if (typeof subject !== "string" || !subject.trim() || subject.length > 200 || typeof origin !== "string" || !isEmbedOriginAllowed(settings.origins, origin)) throw new FlowError("Usuário ou site não autorizado.", 403);
  const identity: EmbedIdentity = { flowId, subject, origin, exp: Date.now() + 10 * 60_000, generation: createHash("sha256").update(key).digest("hex").slice(0, 12) };
  const payload = Buffer.from(JSON.stringify(identity)).toString("base64url");
  return { token: payload + "." + createHmac("sha256", key).update(payload).digest("base64url"), expiresAt: identity.exp };
}
export function authenticateEmbed(req: Request): EmbedIdentity {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  try {
    if (token.length > 2000) throw 0;
    const [payload, signature, extra] = token.split(".");
    if (extra || !payload || !signature) throw 0;
    const i = JSON.parse(Buffer.from(payload, "base64url").toString()) as EmbedIdentity;
    const key = getConfig(keyName(i.flowId)); if (!key) throw 0;
    const expected = createHmac("sha256", key).update(payload).digest();
    const received = Buffer.from(signature, "base64url");
    if (received.length !== expected.length || !timingSafeEqual(expected, received) || i.exp < Date.now() || typeof i.subject !== "string") throw 0;
    const settings = embedSettings(i.flowId);
    if (!settings.enabled || !isEmbedOriginAllowed(settings.origins, i.origin) || !getFlow(i.flowId).published) throw 0;
    return i;
  } catch { throw new FlowError("Sua conexão expirou. Reconecte o chat.", 401); }
}
export function putSession(s: EmbedSession) { db().prepare("INSERT INTO embed_sessions VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(s.id, JSON.stringify(s)); return s; }
export function getSession(id: string): EmbedSession {
  const row = db().prepare("SELECT body FROM embed_sessions WHERE id=?").get(id) as { body: string } | undefined;
  if (!row) throw new FlowError("Conversa não encontrada.", 404);
  return JSON.parse(row.body);
}
export function ownedSession(id: string, i: EmbedIdentity) {
  const s = getSession(id);
  if (s.flowId !== i.flowId || s.subject !== i.subject || s.origin !== i.origin) throw new FlowError("Conversa não encontrada.", 404);
  return s;
}
export function connectSession(i: EmbedIdentity, id: unknown, tabId: unknown, capabilities: unknown) {
  if (typeof tabId !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(tabId)) throw new FlowError("Identificação da aba inválida.");
  const s: EmbedSession = typeof id === "string" && id ? ownedSession(id, i) : { id: randomUUID(), flowId: i.flowId, subject: i.subject, origin: i.origin, tabId, runIds: [], capabilities: [], connectedAt: 0, attachments: [], context: "", createdAt: Date.now() };
  if (s.tabId !== tabId) throw new FlowError("Esta conversa está vinculada a outra aba. Inicie uma nova conversa.", 409);
  s.capabilities = validCapabilities(capabilities); s.connectedAt = Date.now();
  return putSession(s);
}
export function requestRun(sessionId: string, requestId: string) {
  const row = db().prepare("SELECT run_id FROM embed_requests WHERE session_id=? AND request_id=?").get(sessionId, requestId) as { run_id: string } | undefined;
  return row?.run_id;
}
export function attachRun(sessionId: string, requestId: string, runId: string) {
  const s = getSession(sessionId);
  db().prepare("INSERT INTO embed_requests VALUES(?,?,?)").run(sessionId, requestId, runId);
  s.runIds.push(runId); putSession(s);
}
export function putCommand(c: PageCommand) {
  db().prepare("INSERT INTO embed_commands VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(c.id, c.sessionId, c.runId, JSON.stringify(c)); return c;
}
export function commands(sessionId: string): PageCommand[] {
  return (db().prepare("SELECT body FROM embed_commands WHERE session_id=? ORDER BY rowid DESC LIMIT 100").all(sessionId) as {body:string}[]).map(r => JSON.parse(r.body));
}
export function command(id: string): PageCommand {
  const row = db().prepare("SELECT body FROM embed_commands WHERE id=?").get(id) as {body:string} | undefined;
  if (!row) throw new FlowError("Solicitação não encontrada.", 404);
  return JSON.parse(row.body);
}
export function settleCommand(sessionId: string, id: string, action: "claim" | "result", result?: unknown, success = true) {
  const c = command(id);
  if (c.sessionId !== sessionId) throw new FlowError("Solicitação não encontrada.", 404);
  if (getRun(c.runId).status !== "running" || c.expiresAt <= Date.now()) throw new FlowError("Esta solicitação não está mais ativa.", 409);
  if (action === "claim") {
    if (c.status !== "pending") throw new FlowError("Solicitação já recebida. Não repita a ação.", 409);
    c.status = "delivered";
  } else {
    if (c.status !== "delivered") throw new FlowError("Solicitação já respondida ou não recebida.", 409);
    const value = JSON.stringify(result ?? null);
    if (value.length > 16000) throw new FlowError("A resposta da página excedeu o limite.");
    c.result = value; c.status = success ? "completed" : "failed";
  }
  return putCommand(c);
}
export function cancelCommands(runId: string) {
  for (const row of db().prepare("SELECT body FROM embed_commands WHERE run_id=?").all(runId) as {body:string}[]) {
    const c: PageCommand = JSON.parse(row.body);
    if (["pending", "delivered"].includes(c.status)) putCommand({ ...c, status: "cancelled" });
  }
}
