import test from "node:test";
import assert from "node:assert/strict";
import { describeSchedule, formatScheduleInstant, nextScheduleRun, normalizeSchedule, scheduleDraft, zonedInstant, type ScheduleDefinition } from "./flow-schedules";

const base: ScheduleDefinition = { prompt: "Resumo", startDate: "2026-10-28", time: "16:30", frequency: "day", weekdays: [0, 1, 2, 3, 4, 5, 6], until: null };
const at = (iso: string) => Date.parse(iso);

test("horário local de Brasília vira o instante UTC certo", () => {
  assert.equal(new Date(zonedInstant("2026-10-28", "16:30")).toISOString(), "2026-10-28T19:30:00.000Z");
});

test("diário respeita início, dias da semana e data final", () => {
  assert.equal(nextScheduleRun(base, at("2026-10-01T00:00:00Z"))?.toISOString(), "2026-10-28T19:30:00.000Z");
  assert.equal(nextScheduleRun(base, at("2026-10-28T19:30:00Z"))?.toISOString(), "2026-10-29T19:30:00.000Z");
  // 31/10/2026 é sábado: de segunda a sexta pula para 02/11.
  const weekdays = { ...base, weekdays: [1, 2, 3, 4, 5] };
  assert.equal(nextScheduleRun(weekdays, at("2026-10-30T20:00:00Z"))?.toISOString(), "2026-11-02T19:30:00.000Z");
  const limited = { ...base, until: "2026-10-29" };
  assert.equal(nextScheduleRun(limited, at("2026-10-29T19:30:00Z")), null);
});

test("uma vez e mensal (último dia em meses curtos)", () => {
  const once = { ...base, frequency: "once" as const };
  assert.equal(nextScheduleRun(once, at("2026-10-28T19:00:00Z"))?.toISOString(), "2026-10-28T19:30:00.000Z");
  assert.equal(nextScheduleRun(once, at("2026-10-28T19:30:00Z")), null);
  const monthly = { ...base, frequency: "month" as const, startDate: "2027-01-31", weekdays: [] };
  assert.equal(nextScheduleRun(monthly, at("2027-02-01T00:00:00Z"))?.toISOString(), "2027-02-28T19:30:00.000Z");
  assert.equal(nextScheduleRun(monthly, at("2027-03-01T00:00:00Z"))?.toISOString(), "2027-03-31T19:30:00.000Z");
});

test("validação recusa definições incompletas", () => {
  assert.throws(() => normalizeSchedule({ ...base, prompt: " " }), /prompt/);
  assert.throws(() => normalizeSchedule({ ...base, startDate: "2026-02-30" }), /data de início/);
  assert.throws(() => normalizeSchedule({ ...base, time: "24:00" }), /horário/);
  assert.throws(() => normalizeSchedule({ ...base, weekdays: [] }), /dia da semana/);
  assert.throws(() => normalizeSchedule({ ...base, until: "2026-10-01" }), /data final/);
  assert.deepEqual(normalizeSchedule({ ...base, frequency: "once", until: "2026-12-01", weekdays: [1] }), { ...base, frequency: "once", weekdays: [], until: null });
});

test("descrição e rascunho", () => {
  assert.equal(describeSchedule({ ...base, until: "2026-11-11" }), "Repete todos os dias às 16:30 até 11/11/2026");
  assert.equal(describeSchedule({ ...base, weekdays: [1, 2, 3, 4, 5] }), "Repete de segunda a sexta às 16:30");
  assert.equal(describeSchedule({ ...base, weekdays: [1, 3] }), "Repete às segundas e quartas às 16:30");
  assert.equal(describeSchedule({ ...base, frequency: "once" }), "Executa uma vez em 28/10/2026 às 16:30");
  assert.equal(describeSchedule({ ...base, frequency: "month" }), "Repete todo dia 28 do mês às 16:30");
  assert.equal(formatScheduleInstant("2026-10-28T15:30:00.000Z"), "28/10/2026 às 12:30");
  const draft = scheduleDraft(at("2026-10-27T19:10:00Z"));
  assert.equal(draft.startDate, "2026-10-28");
  assert.equal(draft.time, "17:00");
});
