import { FlowError, getRun } from "./flow-service";
import { buildRun, cancelRun } from "./flow-runtime";
import { cancelCommands, commands, embedSettings, getSession, updateSession, requestRun, readSession, assertSessionIdentity, type EmbedIdentity, ownedSession } from "./embed-store";
import { currentTenant } from "./tenant-context";
import { capacity, insertJob, enqueueResume, queueLock } from "./saas-jobs";
import { consumeMonthlyRun } from "./saas-plan";
import { persistTenantRun } from "./tenant-flows";
import { notifyJob } from "./saas-queue";
import { consumeRateLimit } from "./saas-rate-limit";
import type { EmbedTurn } from "./embed-protocol";

export async function sendEmbedMessage(sessionId: string, identity: EmbedIdentity, input: unknown, requestId: unknown, attachmentIds: unknown) {
  const session = await ownedSession(sessionId, identity), { db, user } = currentTenant();
  if (typeof requestId !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) throw new FlowError("Identificador de mensagem inválido.");
  const existing = await requestRun(session.id, requestId); if (existing) return { runId: existing };
  if (!Array.isArray(attachmentIds) || attachmentIds.some(id => typeof id !== "string" || !session.attachments.includes(id))) throw new FlowError("Anexo não pertence à conversa.");
  await consumeRateLimit(db, `embed-message:user:${user.id}`, 20, 60);
  const history = [];
  for (const id of session.runIds) if ((await getRun(id)).status === "completed") history.push(id);
  const run = await buildRun(session.flowId, input, true, false, attachmentIds, history, { sessionId: session.id, maxActiveMs: (await embedSettings(session.flowId)).maxMinutes * 60000 });
  run.queued = true;
  const result = await db.transaction(async sql => {
    // Same queue/owner lock order and quotas as every private execution.
    await queueLock(sql);
    const duplicate = (await sql.query<{ run_id: string }>("SELECT run_id FROM embed_requests WHERE user_id=$1 AND session_id=$2 AND request_id=$3", [user.id, session.id, requestId])).rows[0];
    if (duplicate) return { runId: duplicate.run_id };
    await capacity(sql, user.id);
    const fresh = await readSession(sql, user.id, session.id, true); assertSessionIdentity(fresh, identity);
    if (fresh.runIds.length >= 100) throw new FlowError("Esta conversa atingiu o limite. Inicie uma nova conversa.");
    if (attachmentIds.some(id => !fresh.attachments.includes(id))) throw new FlowError("Anexo não pertence à conversa.");
    const active = await sql.query("SELECT 1 FROM runs r JOIN embed_requests e ON r.user_id=e.user_id AND r.id=e.run_id WHERE e.user_id=$1 AND e.session_id=$2 AND r.status IN ('running','waiting') LIMIT 1", [user.id, session.id]);
    if (active.rows.length) throw new FlowError("Conclua ou cancele a tarefa atual antes de enviar outra mensagem.", 409);
    await consumeMonthlyRun(sql, user.id);
    await persistTenantRun(sql, user.id, run);
    for (const item of run.attachments || []) await sql.query("UPDATE attachments SET used=true WHERE user_id=$1 AND id=$2", [user.id, item.id]);
    await sql.query("INSERT INTO embed_requests(user_id,session_id,request_id,flow_id,run_id) VALUES($1,$2,$3,$4,$5)", [user.id, session.id, requestId, session.flowId, run.id]);
    const job = await insertJob(sql, { user_id: user.id, kind: "run", resource_id: run.id, run_id: run.id, base_id: null, source_id: null });
    return { runId: run.id, jobId: job.id };
  });
  if (result.jobId) await notifyJob(result.jobId);
  return { runId: result.runId };
}
export async function decideEmbedRun(sessionId: string, runId: string, decision: unknown) {
  const session = await getSession(sessionId);
  if (!session.runIds.includes(runId)) throw new FlowError("Tarefa não encontrada.", 404);
  if (decision === "cancel") { await cancelRun(runId); await cancelCommands(runId); return; }
  if (decision === "retry") throw new FlowError("A tarefa foi interrompida. Revise os efeitos no histórico antes de enviar uma nova mensagem.", 409);
  const { job } = await enqueueResume(runId, decision); await notifyJob(job.id);
}
export async function sessionSnapshot(sessionId: string) {
  const session = await getSession(sessionId);
  const runs = await Promise.all(session.runIds.map(id => getRun(id)));
  const turns: EmbedTurn[] = runs.map(run => {
    const node = run.graph.nodes.find(node => node.id === run.next);
    return { id: run.id, input: run.input, output: run.output, status: run.status, error: run.error, createdAt: run.createdAt, updatedAt: run.updatedAt,
      attachments: run.attachments?.map(item => ({ id: item.id, name: item.name })),
      images: run.trace.flatMap(trace => trace.images || []).filter(image => run.output.includes(`/api/attachments/${image.id}`)).map(image => ({ id: image.id, name: image.name })),
      activity: run.status === "waiting" ? "Aguardando sua decisão" : run.pageCommandId ? "Aguardando a página" : run.status === "running" ? (run.queued ? "Na fila" : node ? node.data.label + " está trabalhando" : "Preparando sua solicitação") : "",
      ...(run.status === "waiting" ? { approval: "decision" } : {}),
    };
  });
  const running = new Set(runs.filter(run => run.status === "running").map(run => run.id));
  return { sessionId, turns, commands: (await commands(session.id, undefined, true)).filter(command => command.expiresAt > Date.now() && running.has(command.runId)), connected: Date.now() - session.connectedAt < 30000 };
}
export async function heartbeat(sessionId: string) { await updateSession(sessionId, session => { session.connectedAt = Date.now(); }); }
