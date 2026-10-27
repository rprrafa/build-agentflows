import { randomUUID } from "node:crypto";
import type { Database, Sql } from "./saas-db";
import { currentTenant, withTenantJob } from "./tenant-context";
import { getTenantFlow } from "./tenant-flows";
import { enqueueRun } from "./saas-jobs";
import { notifyJob } from "./saas-queue";
import { FlowError } from "./flow-store";
import { AuthError } from "./saas-security";
import {
  nextScheduleRun, normalizeSchedule, ScheduleInputError, SCHEDULE_LATE_MS, SCHEDULES_PER_FLOW,
  type FlowSchedule, type ScheduleDefinition,
} from "./flow-schedules";

// Prompts agendados ficam numa tabela própria, fora do grafo: o webhook, o MCP, o embed e a
// exportação do fluxo não leem nem alteram agendamentos. Cada ocorrência vira uma execução comum
// (fila, plano mensal, último grafo salvo) marcada com scheduleId, sem sessão nem histórico.

type Stored = Omit<FlowSchedule, "status" | "nextRunAt">;
type Row = { id: string; flow_id: string; user_id: string; body: Stored; active: boolean; next_run_at: string | null };

const COLUMNS = "user_id,id,flow_id,body,active,next_run_at";
function present(row: Row): FlowSchedule {
  const nextRunAt = row.next_run_at ? new Date(row.next_run_at).toISOString() : null;
  return { ...row.body, status: !row.active ? "paused" : nextRunAt ? "active" : "ended", nextRunAt };
}
function definition(input: unknown): ScheduleDefinition {
  try { return normalizeSchedule(input); }
  catch (error) { throw error instanceof ScheduleInputError ? new FlowError(error.message) : error; }
}
async function readSchedule(sql: Sql, owner: string, flowId: string, id: string, lock = false) {
  const { rows } = await sql.query<Row>(`SELECT ${COLUMNS} FROM flow_schedules WHERE user_id=$1 AND flow_id=$2 AND id=$3${lock ? " FOR UPDATE" : ""}`, [owner, flowId, id]);
  if (!rows[0]) throw new FlowError("Agendamento não encontrado.", 404);
  return rows[0];
}

export async function listFlowSchedules(flowId: string) {
  const { db, user } = currentTenant();
  await getTenantFlow(flowId);
  const { rows } = await db.query<Row>(`SELECT ${COLUMNS} FROM flow_schedules WHERE user_id=$1 AND flow_id=$2 ORDER BY created_at,id`, [user.id, flowId]);
  return rows.map(present);
}

export async function createFlowSchedule(flowId: string, input: unknown) {
  const { db, user } = currentTenant();
  const value = definition(input), now = new Date().toISOString();
  const next = nextScheduleRun(value, Date.now());
  if (!next) throw new FlowError("Esse horário já passou. Escolha uma data futura.");
  const body: Stored = { ...value, id: randomUUID(), flowId, createdAt: now, updatedAt: now };
  return db.transaction(async (sql) => {
    // Trava o fluxo: limite por fluxo sem corrida e sem criar agendamento de fluxo em exclusão.
    if (!(await sql.query("SELECT 1 FROM flows WHERE user_id=$1 AND id=$2 FOR UPDATE", [user.id, flowId])).rows.length) throw new FlowError("Fluxo não encontrado.", 404);
    const { rows } = await sql.query<{ n: number }>("SELECT count(*)::int n FROM flow_schedules WHERE user_id=$1 AND flow_id=$2", [user.id, flowId]);
    if (rows[0].n >= SCHEDULES_PER_FLOW) throw new FlowError(`Cada fluxo aceita até ${SCHEDULES_PER_FLOW} agendamentos. Exclua um para criar outro.`, 409);
    const saved = await sql.query<Row>(`INSERT INTO flow_schedules(user_id,id,flow_id,body,next_run_at) VALUES($1,$2,$3,$4,$5) RETURNING ${COLUMNS}`,
      [user.id, body.id, flowId, JSON.stringify(body), next.toISOString()]);
    return present(saved.rows[0]);
  });
}

/** Troca a definição mantendo pausa, histórico e criação. */
export async function updateFlowSchedule(flowId: string, id: string, input: unknown) {
  const { db, user } = currentTenant();
  const value = definition(input);
  return db.transaction(async (sql) => {
    const row = await readSchedule(sql, user.id, flowId, id, true);
    const next = row.active ? nextScheduleRun(value, Date.now()) : null;
    if (row.active && !next) throw new FlowError("Esse horário já passou. Escolha uma data futura.");
    const body: Stored = { ...row.body, ...value, updatedAt: new Date().toISOString() };
    const saved = await sql.query<Row>(`UPDATE flow_schedules SET body=$4,next_run_at=$5 WHERE user_id=$1 AND flow_id=$2 AND id=$3 RETURNING ${COLUMNS}`,
      [user.id, flowId, id, JSON.stringify(body), next?.toISOString() ?? null]);
    return present(saved.rows[0]);
  });
}

/** Pausar descarta a próxima ocorrência; retomar calcula a seguinte a partir de agora. */
export async function setFlowScheduleActive(flowId: string, id: string, active: unknown) {
  if (typeof active !== "boolean") throw new FlowError("Informe se o agendamento fica ativo.");
  const { db, user } = currentTenant();
  return db.transaction(async (sql) => {
    const row = await readSchedule(sql, user.id, flowId, id, true);
    const next = active ? nextScheduleRun(row.body, Date.now()) : null;
    if (active && !next) throw new FlowError("Este agendamento não tem próximas execuções. Edite as datas para retomá-lo.", 409);
    const saved = await sql.query<Row>(`UPDATE flow_schedules SET active=$4,next_run_at=$5 WHERE user_id=$1 AND flow_id=$2 AND id=$3 RETURNING ${COLUMNS}`,
      [user.id, flowId, id, active, next?.toISOString() ?? null]);
    return present(saved.rows[0]);
  });
}

export async function deleteFlowSchedule(flowId: string, id: string) {
  const { db, user } = currentTenant();
  const { rows } = await db.query("DELETE FROM flow_schedules WHERE user_id=$1 AND flow_id=$2 AND id=$3 RETURNING id", [user.id, flowId, id]);
  if (!rows.length) throw new FlowError("Agendamento não encontrado.", 404);
}

async function recordOutcome(sql: Sql, owner: string, id: string, at: string, outcome: { runId?: string; error?: string }) {
  const patch = { lastRunAt: at, ...(outcome.runId ? { lastRunId: outcome.runId } : {}), ...(outcome.error ? { lastError: outcome.error } : {}) };
  await sql.query("UPDATE flow_schedules SET body=(body - 'lastError') || $3::jsonb WHERE user_id=$1 AND id=$2", [owner, id, JSON.stringify(patch)]);
}
/** Enfileira o prompt dentro do contexto do dono; a próxima ocorrência não muda. */
async function enqueueSchedule(row: Row) {
  const { run, job } = await enqueueRun(row.flow_id, row.body.prompt, false, false, undefined, undefined, undefined, undefined, undefined, row.id);
  await notifyJob(job.id);
  return run;
}

/** "Executar agora": mesma execução do horário agendado, sem alterar a próxima ocorrência. */
export async function runFlowScheduleNow(flowId: string, id: string) {
  const { db, user } = currentTenant();
  const row = await readSchedule(db, user.id, flowId, id);
  const run = await enqueueSchedule(row);
  await recordOutcome(db, user.id, id, new Date().toISOString(), { runId: run.id });
  return { run: { id: run.id, status: run.status, queued: !!run.queued } };
}

/**
 * Worker: reivindica cada agendamento vencido avançando next_run_at na mesma transação, depois enfileira.
 * Uma queda entre os dois passos perde a ocorrência em vez de repeti-la; ocorrências atrasadas além de
 * SCHEDULE_LATE_MS (worker parado) são registradas como perdidas e não executam fora de hora.
 */
export async function dispatchDueSchedules(db: Database, now = Date.now(), max = 20) {
  let dispatched = 0;
  for (; dispatched < max; dispatched++) {
    const claimed = await db.transaction(async (sql) => {
      const { rows } = await sql.query<Row>(`SELECT ${COLUMNS} FROM flow_schedules WHERE active AND next_run_at<=$1
        ORDER BY next_run_at LIMIT 1 FOR UPDATE SKIP LOCKED`, [new Date(now).toISOString()]);
      const row = rows[0];
      if (!row) return undefined;
      const due = Date.parse(row.next_run_at!);
      const next = nextScheduleRun(row.body, Math.max(now, due));
      await sql.query("UPDATE flow_schedules SET next_run_at=$3 WHERE user_id=$1 AND id=$2", [row.user_id, row.id, next?.toISOString() ?? null]);
      return { row, due, late: now - due > SCHEDULE_LATE_MS };
    });
    if (!claimed) break;
    const { row, due, late } = claimed;
    let outcome: { runId?: string; error?: string };
    if (late) outcome = { error: "O horário passou enquanto o serviço estava indisponível; esta ocorrência não foi executada." };
    else {
      try { outcome = { runId: (await withTenantJob(db, row.user_id, () => enqueueSchedule(row))).id }; }
      catch (error) { outcome = { error: error instanceof FlowError || error instanceof AuthError ? error.message : "Não foi possível iniciar a execução agendada." }; }
    }
    await recordOutcome(db, row.user_id, row.id, new Date(late ? due : now).toISOString(), outcome);
  }
  return dispatched;
}
