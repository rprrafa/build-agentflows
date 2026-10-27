// Prompts agendados do bloco Início: regras puras (validação, próxima execução e descrição),
// compartilhadas entre o servidor, o worker e o editor. Horários no fuso do produto (Brasília).

export const SCHEDULE_TIME_ZONE = "America/Sao_Paulo";
export const SCHEDULES_PER_FLOW = 10;
export const SCHEDULE_PROMPT_LIMIT = 20000;
/** Ocorrência atrasada além disso (worker parado) é pulada em vez de executar fora de hora. */
export const SCHEDULE_LATE_MS = 60 * 60_000;
export const SCHEDULE_FREQUENCIES = [
  { id: "once", label: "Não repetir" },
  { id: "day", label: "Dia" },
  { id: "month", label: "Mês" },
] as const;
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number]["id"];
/** Domingo = 0, como Date.getUTCDay. */
export const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export type ScheduleDefinition = {
  prompt: string;
  /** Data local AAAA-MM-DD da primeira execução. */
  startDate: string;
  /** Horário local HH:MM. */
  time: string;
  frequency: ScheduleFrequency;
  /** Dias da semana na frequência "day". */
  weekdays: number[];
  /** Última data local (inclusive); null repete sem fim. */
  until: string | null;
};
export type ScheduleStatus = "active" | "paused" | "ended";
export type FlowSchedule = ScheduleDefinition & {
  id: string;
  flowId: string;
  status: ScheduleStatus;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastRunId?: string;
  lastError?: string;
};

export class ScheduleInputError extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/, TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const dayNumber = (date: string) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86_400_000;
const dateOf = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);
function validDate(value: unknown): value is string {
  return typeof value === "string" && DATE.test(value) && dateOf(dayNumber(value)) === value;
}

/** Valida a definição enviada pelo editor; mensagens em linguagem de pessoa usuária. */
export function normalizeSchedule(input: unknown): ScheduleDefinition {
  const v = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const prompt = typeof v.prompt === "string" ? v.prompt.trim() : "";
  if (!prompt) throw new ScheduleInputError("Escreva o prompt que será enviado ao fluxo.");
  if (prompt.length > SCHEDULE_PROMPT_LIMIT) throw new ScheduleInputError("O prompt pode ter até 20 mil caracteres.");
  if (!validDate(v.startDate)) throw new ScheduleInputError("Informe uma data de início válida.");
  if (typeof v.time !== "string" || !TIME.test(v.time)) throw new ScheduleInputError("Informe um horário válido.");
  const frequency = SCHEDULE_FREQUENCIES.find((f) => f.id === v.frequency)?.id;
  if (!frequency) throw new ScheduleInputError("Escolha com que frequência repetir.");
  const weekdays = frequency === "day"
    ? [...new Set(Array.isArray(v.weekdays) ? v.weekdays : ALL_DAYS)].filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6).sort()
    : [];
  if (frequency === "day" && !weekdays.length) throw new ScheduleInputError("Escolha pelo menos um dia da semana.");
  let until: string | null = null;
  if (frequency !== "once" && v.until !== null && v.until !== undefined && v.until !== "") {
    if (!validDate(v.until)) throw new ScheduleInputError("Informe uma data final válida.");
    if (v.until < v.startDate) throw new ScheduleInputError("A data final precisa ser igual ou posterior ao início.");
    until = v.until;
  }
  return { prompt, startDate: v.startDate, time: v.time, frequency, weekdays, until };
}

/** Diferença (ms) entre o relógio do fuso e o UTC no instante dado. */
function zoneOffset(instant: number, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - Math.floor(instant / 1000) * 1000;
}
/** Instante UTC de uma data e hora locais no fuso. */
export function zonedInstant(date: string, time: string, timeZone = SCHEDULE_TIME_ZONE) {
  const wall = dayNumber(date) * 86_400_000 + (+time.slice(0, 2) * 60 + +time.slice(3, 5)) * 60_000;
  const first = wall - zoneOffset(wall, timeZone);
  return wall - zoneOffset(first, timeZone);
}
/** Data local AAAA-MM-DD de um instante no fuso. */
export function zonedDate(instant: number, timeZone = SCHEDULE_TIME_ZONE) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant));
}

function occursOn(s: ScheduleDefinition, date: string) {
  if (date < s.startDate || (s.until && date > s.until)) return false;
  if (s.frequency === "once") return date === s.startDate;
  if (s.frequency === "day") return s.weekdays.includes(new Date(dayNumber(date) * 86_400_000).getUTCDay());
  // Mensal: mesmo dia do início; meses mais curtos usam o último dia.
  const wanted = +s.startDate.slice(8, 10), day = +date.slice(8, 10);
  const lastDay = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7), 0)).getUTCDate();
  return day === Math.min(wanted, lastDay);
}

/** Próxima ocorrência estritamente depois de `after`, ou null quando o agendamento terminou. */
export function nextScheduleRun(s: ScheduleDefinition, after: Date | number, timeZone = SCHEDULE_TIME_ZONE): Date | null {
  const from = +after;
  let day = Math.max(dayNumber(s.startDate), dayNumber(zonedDate(from, timeZone)) - 1);
  const last = s.until ? dayNumber(s.until) : day + 800;
  for (; day <= last; day++) {
    const date = dateOf(day);
    if (!occursOn(s, date)) continue;
    const instant = zonedInstant(date, s.time, timeZone);
    if (instant > from) return new Date(instant);
  }
  return null;
}

const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
const PLURAL = ["domingos", "segundas", "terças", "quartas", "quintas", "sextas", "sábados"];
function list(items: string[]) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}
function days(weekdays: number[]) {
  const key = weekdays.join("");
  if (key === "0123456") return "todos os dias";
  if (key === "12345") return "de segunda a sexta";
  if (key === "06") return "aos fins de semana";
  return `às ${list(weekdays.map((d) => PLURAL[d]))}`;
}
/** Frase do resumo, como "Repete de segunda a sexta às 08:00 até 11/11/2026". */
export function describeSchedule(s: ScheduleDefinition) {
  if (s.frequency === "once") return `Executa uma vez em ${shortDate(s.startDate)} às ${s.time}`;
  const until = s.until ? ` até ${shortDate(s.until)}` : "";
  if (s.frequency === "month") return `Repete todo dia ${+s.startDate.slice(8, 10)} do mês às ${s.time}${until}`;
  return `Repete ${days(s.weekdays)} às ${s.time}${until}`;
}
/** "28/10/2026 às 12:30" no fuso do produto. */
export function formatScheduleInstant(iso: string, timeZone = SCHEDULE_TIME_ZONE) {
  const instant = Date.parse(iso);
  const time = new Intl.DateTimeFormat("pt-BR", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(instant));
  return `${shortDate(zonedDate(instant, timeZone))} às ${time}`;
}
export const SCHEDULE_STATUS_LABEL: Record<ScheduleStatus, string> = { active: "Ativo", paused: "Pausado", ended: "Encerrado" };

/** Rascunho de um novo agendamento: amanhã, no próximo horário cheio, todos os dias. */
export function scheduleDraft(now = Date.now(), timeZone = SCHEDULE_TIME_ZONE): ScheduleDefinition {
  const today = zonedDate(now, timeZone);
  const hour = +new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(new Date(now));
  return { prompt: "", startDate: dateOf(dayNumber(today) + 1), time: `${String((hour + 1) % 24).padStart(2, "0")}:00`, frequency: "day", weekdays: [...ALL_DAYS], until: null };
}
