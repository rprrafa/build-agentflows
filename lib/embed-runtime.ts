import { abrirBanco } from "./store";
import { FlowError, getRun, putRun } from "./flow-store";
import { cancelRun, execute, prepareRun, prepareResume } from "./flow-runtime";
import { attachRun, cancelCommands, commands, embedSettings, getSession, putSession, requestRun, type EmbedIdentity, ownedSession } from "./embed-store";
import type { EmbedTurn } from "./embed-protocol";
function db() {
  const d = abrirBanco();
  d.exec("CREATE TABLE IF NOT EXISTS embed_jobs (run_id TEXT PRIMARY KEY, status TEXT NOT NULL)");
  return d;
}
const locks = new Set<string>();
const busy = new Set<string>();
export async function sendEmbedMessage(sessionId: string, identity: EmbedIdentity, input: unknown, requestId: unknown, attachmentIds: unknown) {
  const s = ownedSession(sessionId, identity);
  if (typeof requestId !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) throw new FlowError("Identificador de mensagem inválido.");
  const existing = requestRun(s.id, requestId); if (existing) return { runId: existing };
  if (locks.has(s.id)) throw new FlowError("Sua mensagem está sendo recebida. Aguarde um instante.", 409);
  if (s.runIds.length >= 100) throw new FlowError("Esta conversa atingiu o limite. Inicie uma nova conversa.");
  if (s.runIds.some(id => ["running", "waiting"].includes(getRun(id).status))) throw new FlowError("Conclua ou cancele a tarefa atual antes de enviar outra mensagem.", 409);
  if (!Array.isArray(attachmentIds) || attachmentIds.some(id => typeof id !== "string" || !s.attachments.includes(id))) throw new FlowError("Anexo não pertence à conversa.");
  locks.add(s.id);
  try {
    const history = s.runIds.filter(id => getRun(id).status === "completed");
    const r = await prepareRun(s.flowId, input, true, false, attachmentIds, history, { sessionId: s.id, maxActiveMs: embedSettings(s.flowId).maxMinutes * 60_000 });
    attachRun(s.id, requestId, r.id);
    db().prepare("INSERT INTO embed_jobs VALUES(?,'queued')").run(r.id);
    return { runId: r.id };
  } finally { locks.delete(s.id); }
}
export async function decideEmbedRun(sessionId: string, runId: string, decision: unknown) {
  const s = getSession(sessionId);
  if (!s.runIds.includes(runId)) throw new FlowError("Tarefa não encontrada.", 404);
  if (decision === "cancel") { await cancelRun(runId); db().prepare("UPDATE embed_jobs SET status='done' WHERE run_id=?").run(runId); return; }
  let r = getRun(runId);
  if (r.interrupted) {
    if (decision !== "retry" || r.status !== "waiting") throw new FlowError("Confirme a retomada da etapa interrompida.");
    if ((r.recoveryAttempts || 0) >= 2) throw new FlowError("Limite de retomadas atingido. Revise a tarefa antes de continuar.");
    r.recoveryAttempts = (r.recoveryAttempts || 0) + 1;
    r.interrupted = false; r.error = undefined; r.status = "running"; putRun(r);
  } else r = await prepareResume(runId, decision);
  db().prepare("INSERT INTO embed_jobs VALUES(?,'queued') ON CONFLICT(run_id) DO UPDATE SET status='queued'").run(r.id);
}
/** Single-process SQLite worker. Jobs survive HTTP disconnects; ambiguous effects require human recovery. */
export async function drainEmbedJobs() {
  if (busy.size >= 4) return;
  const rows = db().prepare("SELECT run_id FROM embed_jobs WHERE status='queued' LIMIT ?").all(4 - busy.size) as { run_id: string }[];
  await Promise.all(rows.map(async ({ run_id }) => {
    if (busy.has(run_id)) return;
    const r = getRun(run_id);
    if (r.status !== "running") { db().prepare("UPDATE embed_jobs SET status='done' WHERE run_id=?").run(run_id); return; }
    const claimed = db().prepare("UPDATE embed_jobs SET status='working' WHERE run_id=? AND status='queued'").run(run_id);
    if (!claimed.changes) return;
    busy.add(run_id);
    try { await execute(r); }
    finally { busy.delete(run_id); db().prepare("UPDATE embed_jobs SET status='done' WHERE run_id=?").run(run_id); }
  }));
}
export function recoverEmbedJobs() {
  // A crash between creating a run and queuing it must not leave an invisible task forever.
  for (const row of db().prepare("SELECT body FROM flow_runs WHERE status='running' AND id NOT IN (SELECT run_id FROM embed_jobs)").all() as {body:string}[]) {
    const r = JSON.parse(row.body);
    if (!r.embedSessionId) continue;
    r.status = "failed"; r.error = "O serviço reiniciou ao receber esta tarefa. Envie sua mensagem novamente."; putRun(r);
  }
  for (const row of db().prepare("SELECT run_id FROM embed_jobs WHERE status='working'").all() as {run_id:string}[]) {
    const r = getRun(row.run_id);
    if (r.status === "running") {
      r.activeMs = (r.activeMs || 0) + (r.activeSegmentStartedAt ? Math.max(0, Date.now() - r.activeSegmentStartedAt) : 0);
      delete r.activeSegmentStartedAt;
      r.status = "waiting"; r.interrupted = true;
      r.error = "O serviço reiniciou durante esta etapa. Uma ação externa pode ter sido concluída. Confira o resultado antes de retomar.";
      delete r.pageCommandId; cancelCommands(r.id); putRun(r);
    }
    db().prepare("UPDATE embed_jobs SET status='done' WHERE run_id=?").run(r.id);
  }
}
export function sessionSnapshot(sessionId: string) {
  const s = getSession(sessionId);
  const turns: EmbedTurn[] = s.runIds.map(id => {
    const r = getRun(id), n = r.graph.nodes.find(n => n.id === r.next);
    return { id: r.id, input: r.input, output: r.output, status: r.status, error: r.error, createdAt: r.createdAt, updatedAt: r.updatedAt,
      attachments: r.attachments?.map(a => ({ id: a.id, name: a.name })),
      activity: r.interrupted ? "Aguardando revisão para retomar" : r.status === "waiting" ? "Aguardando sua decisão" : r.pageCommandId ? "Aguardando a página" : r.status === "running" ? (n ? n.data.label + " está trabalhando" : "Preparando sua solicitação") : "",
      ...(r.status === "waiting" ? { approval: r.interrupted ? "recovery" : "decision" } : {}),
    };
  });
  return { sessionId, turns, commands: commands(s.id).filter(c => ["pending", "delivered"].includes(c.status) && c.expiresAt > Date.now() && getRun(c.runId).status === "running"), connected: Date.now() - s.connectedAt < 30_000 };
}
export function heartbeat(sessionId: string) { const s = getSession(sessionId); s.connectedAt = Date.now(); putSession(s); }
