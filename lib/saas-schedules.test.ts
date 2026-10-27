import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createTestDatabase } from "../scripts/saas-test-db";
import { migrateDatabase } from "./db/migrate";
import { withTenantJob } from "./tenant-context";
import { createTenantFlow, deleteTenantFlow, getTenantFlow, saveTenantFlow } from "./tenant-flows";
import { createFlowSchedule, deleteFlowSchedule, dispatchDueSchedules, listFlowSchedules, runFlowScheduleNow, setFlowScheduleActive, updateFlowSchedule } from "./tenant-schedules";
import { scheduleDraft, SCHEDULES_PER_FLOW } from "./flow-schedules";
import { block, type Run } from "./flow-types";

const testDb = await createTestDatabase();
const { db } = testDb;
const a = randomUUID(), b = randomUUID();
const asA = <T>(action: () => T | Promise<T>) => withTenantJob(db, a, action);
const asB = <T>(action: () => T | Promise<T>) => withTenantJob(db, b, action);
process.env.CHAVE_MESTRA = randomBytes(32).toString("base64");
test.before(async () => { await migrateDatabase(db); });
test.after(async () => { await testDb.close(); });
test.beforeEach(async () => {
  await testDb.exec("TRUNCATE users CASCADE");
  for (const id of [a, b]) await db.query("INSERT INTO users(id,name,email,email_verified_at,beta_status) VALUES($1,'Pessoa teste',$2,now(),'approved')", [id, `${id}@example.com`]);
});
const direct = () => createTenantFlow("Direto", false, { name: "Direto", description: "", graph: { nodes: [block("start", "inicio", 0, 0), block("end", "resposta", 300, 0)], edges: [{ id: "e1", source: "inicio", target: "resposta" }] } });
const draft = (prompt = "Resumo do dia") => ({ ...scheduleDraft(), prompt });
const runs = async () => (await db.query<{ body: Run }>("SELECT body FROM runs WHERE user_id=$1 ORDER BY sequence", [a])).rows.map((r) => r.body);

test("vários agendamentos por fluxo, isolados por conta e fora do grafo", async () => {
  const flow = await asA(direct);
  const first = await asA(() => createFlowSchedule(flow.id, draft("[FECHAMENTO] compromissos")));
  await asA(() => createFlowSchedule(flow.id, draft("[CHECKPOINT] pendências")));
  assert.equal(first.status, "active");
  assert.ok(first.nextRunAt);
  assert.deepEqual((await asA(() => listFlowSchedules(flow.id))).map((s) => s.prompt), ["[FECHAMENTO] compromissos", "[CHECKPOINT] pendências"]);
  // Salvar o fluxo, ou lê-lo como a API lê, não toca nos agendamentos e o corpo do fluxo não os carrega.
  await asA(() => saveTenantFlow(flow.id, { ...flow, name: "Renomeado" }));
  assert.equal((await asA(() => listFlowSchedules(flow.id))).length, 2);
  assert.equal(JSON.stringify(await asA(() => getTenantFlow(flow.id))).includes("FECHAMENTO"), false);
  await assert.rejects(asB(() => listFlowSchedules(flow.id)), /Fluxo não encontrado/);
  await assert.rejects(asB(() => deleteFlowSchedule(flow.id, first.id)), /não encontrado/);
  for (let i = 2; i < SCHEDULES_PER_FLOW; i++) await asA(() => createFlowSchedule(flow.id, draft(`P${i}`)));
  await assert.rejects(asA(() => createFlowSchedule(flow.id, draft())), /até 10 agendamentos/);
  await asA(() => deleteTenantFlow(flow.id));
  assert.equal((await db.query("SELECT 1 FROM flow_schedules WHERE user_id=$1", [a])).rows.length, 0);
});

test("editar, pausar, retomar e horário passado", async () => {
  const flow = await asA(direct);
  await assert.rejects(asA(() => createFlowSchedule(flow.id, { ...draft(), frequency: "once", startDate: "2020-01-01" })), /já passou/);
  const s = await asA(() => createFlowSchedule(flow.id, draft()));
  const paused = await asA(() => setFlowScheduleActive(flow.id, s.id, false));
  assert.deepEqual([paused.status, paused.nextRunAt], ["paused", null]);
  // Editar pausado mantém a pausa.
  assert.equal((await asA(() => updateFlowSchedule(flow.id, s.id, draft("Outro")))).status, "paused");
  const resumed = await asA(() => setFlowScheduleActive(flow.id, s.id, true));
  assert.equal(resumed.status, "active");
  assert.equal(resumed.prompt, "Outro");
});

test("worker dispara o vencido uma vez, sem sessão, e registra o resultado", async () => {
  const flow = await asA(direct);
  const s = await asA(() => createFlowSchedule(flow.id, draft()));
  const due = Date.parse(s.nextRunAt!);
  assert.equal(await dispatchDueSchedules(db, due - 1000), 0);
  assert.equal(await dispatchDueSchedules(db, due + 1000), 1);
  assert.equal(await dispatchDueSchedules(db, due + 2000), 0);
  const [run] = await runs();
  assert.equal(run.input, "Resumo do dia");
  assert.equal(run.scheduleId, s.id);
  assert.equal(run.session, undefined);
  assert.equal(run.conversation, undefined);
  const [after] = await asA(() => listFlowSchedules(flow.id));
  assert.equal(after.lastRunId, run.id);
  assert.equal(Date.parse(after.nextRunAt!), due + 86_400_000);
  // Executar agora não muda a próxima ocorrência.
  await db.query("UPDATE jobs SET status='done',finished_at=now() WHERE user_id=$1", [a]);
  const now = await asA(() => runFlowScheduleNow(flow.id, s.id));
  assert.equal((await runs()).length, 2);
  const [again] = await asA(() => listFlowSchedules(flow.id));
  assert.equal(again.lastRunId, now.run.id);
  assert.equal(again.nextRunAt, after.nextRunAt);
});

test("ocorrência muito atrasada é registrada como perdida; falha fica visível e não pausa", async () => {
  const flow = await asA(direct);
  const s = await asA(() => createFlowSchedule(flow.id, draft()));
  const due = Date.parse(s.nextRunAt!);
  assert.equal(await dispatchDueSchedules(db, due + 3 * 3600_000), 1);
  assert.equal((await runs()).length, 0);
  let [stored] = await asA(() => listFlowSchedules(flow.id));
  assert.match(stored.lastError!, /indisponível/);
  assert.equal(stored.status, "active");
  // Conta suspensa: a execução é recusada, o motivo fica no agendamento.
  await db.query("UPDATE users SET beta_status='blocked' WHERE id=$1", [a]);
  assert.equal(await dispatchDueSchedules(db, Date.parse(stored.nextRunAt!) + 1000), 1);
  await db.query("UPDATE users SET beta_status='approved' WHERE id=$1", [a]);
  [stored] = await asA(() => listFlowSchedules(flow.id));
  assert.ok(stored.lastError);
  assert.equal((await runs()).length, 0);
});
