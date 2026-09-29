import { conditionCriteria, COMPARISONS } from "./flow-conditions";
import { memorySettings } from "./memory-settings";
import { validateMediaConfig } from "./media-models";
import { knowledgeSettings } from "./knowledge-settings";
import { validateToolCards } from "./agent-tools";
import { outputs } from "./flow-graph";
import { randomUUID } from "node:crypto";
import { abrirBanco } from "./store";
import {
  BLOCKS,
  block,
  template,
  type Flow,
  type Graph,
  type Run,
  type RunPage,
  type RunSummary,
} from "./flow-types";
export class FlowError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
function db() {
  const d = abrirBanco();
  d.exec(`CREATE TABLE IF NOT EXISTS flows (id TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS flow_runs (id TEXT PRIMARY KEY, flow_id TEXT NOT NULL, status TEXT NOT NULL, body TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS flow_runs_flow ON flow_runs(flow_id);
    CREATE INDEX IF NOT EXISTS flow_runs_status ON flow_runs(status);
    CREATE INDEX IF NOT EXISTS flow_runs_flow_status ON flow_runs(flow_id,status);`);
  return d;
}
export function validateGraph(value: unknown, executable = false): Graph {
  if (!value || typeof value !== "object")
    throw new FlowError("O fluxo precisa de blocos e conexões.");
  const g = value as Graph;
  if (
    !Array.isArray(g.nodes) ||
    !Array.isArray(g.edges) ||
    g.nodes.length > 60 ||
    g.edges.length > 120 ||
    JSON.stringify(g).length > 250000
  )
    throw new FlowError("Use até 60 blocos e 120 conexões por fluxo.");
  const ids = new Set<string>();
  for (const n of g.nodes) {
    if (
      !n ||
      typeof n.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(n.id) ||
      ids.has(n.id) ||
      !n.data ||
      !Object.hasOwn(BLOCKS, n.data.kind) ||
      typeof n.data.label !== "string" ||
      n.data.label.length > 100 ||
      !n.position ||
      !Number.isFinite(n.position.x) ||
      !Number.isFinite(n.position.y) ||
      !n.data.config ||
      Array.isArray(n.data.config) ||
      typeof n.data.config !== "object" ||
      Object.values(n.data.config).some(
        (v) => typeof v !== "string" || v.length > 20000,
      )
    )
      throw new FlowError(
        "Há um bloco inválido ou repetido. Confira o arquivo importado.",
      );
    if (n.data.kind === "condition") {
      try { conditionCriteria(n.data.config); } catch (error) { throw new FlowError((error as Error).message); }
    }
    if (n.data.kind === "agent" || n.data.kind === "llm") {
      try { memorySettings(n.data.config); } catch (error) { throw new FlowError((error as Error).message); }
      try { validateMediaConfig(n.data.config); } catch (error) { throw new FlowError((error as Error).message); }
      try { knowledgeSettings(n.data.config); } catch (error) { throw new FlowError((error as Error).message); }
    }
    if (n.data.kind === "agent") {
      try { validateToolCards(n.data.config.toolCards); } catch (error) { throw new FlowError((error as Error).message); }
    }
    ids.add(n.id);
  }
  const edges = new Set<string>();
  for (const e of g.edges) {
    if (
      !e ||
      typeof e.id !== "string" ||
      edges.has(e.id) ||
      !ids.has(e.source) ||
      !ids.has(e.target) ||
      (e.sourceHandle != null &&
        !outputs(g.nodes.find((n) => n.id === e.source)!.data.kind, g.nodes.find((n) => n.id === e.source)!.data.config).some((o) => o.id === e.sourceHandle))
    )
      throw new FlowError("Há uma conexão inválida.");
    edges.add(e.id);
  }
  if (executable) {
    if (g.nodes.length === 1 && g.nodes[0].data.kind === "start" && g.edges.length === 0)
      throw new FlowError("Este fluxo tem apenas o bloco Início. Adicione e conecte um Agente ou outro bloco para testar no chat.");
    const starts = g.nodes.filter((n) => n.data.kind === "start");
    if (starts.length !== 1)
      throw new FlowError(
        "Use exatamente um Início.",
      );
    for (const n of g.nodes) {
      const out = g.edges.filter((e) => e.source === n.id);
      const k = n.data.kind;
      const handles = (k === "agent" || k === "llm") && out.length === 0 ? [] : outputs(k, n.data.config).map((o) => o.id);
      if (
        out.length !== handles.length ||
        handles.some(
          (h) => out.filter((e) => (e.sourceHandle || null) === h).length !== 1,
        )
      )
        throw new FlowError(
          `Conecte todas as saídas de “${n.data.label}”, uma vez cada.`,
        );
      if (k === "start" && g.edges.some((e) => e.target === n.id))
        throw new FlowError("O Início não pode receber conexões.");
      const c = n.data.config;
      if (k === "state" && !/^[a-zA-Z][a-zA-Z0-9_]{0,60}$/.test(c.key || ""))
        throw new FlowError("Dê um nome válido à variável de estado.");
      if (
        k === "loop" &&
        (!/^\d+$/.test(c.limit || "") || +c.limit < 1 || +c.limit > 20)
      )
        throw new FlowError("A repetição deve ter entre 1 e 20 passagens.");
      if (
        k === "condition" &&
        !conditionCriteria(c).every((row) => COMPARISONS.some(([operator]) => operator === row.operator))
      )
        throw new FlowError("Escolha uma comparação válida.");
      if (k === "http") {
        try {
          const u = new URL(c.url);
          if (
            !["https:", "http:"].includes(u.protocol) ||
            u.username ||
            u.password
          )
            throw 0;
        } catch {
          throw new FlowError(
            "Informe um endereço HTTP válido, sem credenciais.",
          );
        }
        if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(c.method))
          throw new FlowError("Método HTTP inválido.");
      }
      if (k === "tool" && !c.tool?.trim())
        throw new FlowError("Escolha a ferramenta a executar.");
      if ((k === "whatsapp" || k === "call") && !c.to?.trim())
        throw new FlowError(`Informe o número em “${n.data.label}”.`);
      if (k === "agent" || k === "llm") {
        try {
          const updates = JSON.parse(c.stateUpdates || "[]");
          const initial = JSON.parse(starts[0].data.config.state || "{}");
          if (!Array.isArray(updates) || updates.length > 50 || updates.some((u) => !u || typeof u.key !== "string" || !Object.hasOwn(initial, u.key) || typeof u.value !== "string") || new Set(updates.map((u) => u.key)).size !== updates.length) throw 0;
        } catch { throw new FlowError("Escolha variáveis definidas no Início para atualizar, sem repetições."); }
      }
      if (k === "start") {
        try {
          const s = JSON.parse(c.state || "{}");
          if (
            !s ||
            Array.isArray(s) ||
            typeof s !== "object" ||
            Object.values(s).some((v) => typeof v !== "string")
          )
            throw 0;
        } catch {
          throw new FlowError(
            "O estado inicial deve ser um objeto com valores de texto.",
          );
        }
      }
    }
    const reachable = new Set<string>();
    function walk(id: string) {
      if (reachable.has(id)) return;
      reachable.add(id);
      g.edges.filter((e) => e.source === id).forEach((e) => walk(e.target));
    }
    walk(starts[0].id);
    if (reachable.size !== g.nodes.length)
      throw new FlowError(
        "Todos os blocos precisam estar conectados ao Início.",
      );
    // Every block must have a route to an end; bounded loops may revisit earlier blocks.
    const finishing = new Set(
      g.nodes.filter((n) => ["end", "agent", "llm"].includes(n.data.kind) && !g.edges.some((e) => e.source === n.id)).map((n) => n.id),
    );
    for (let i = 0; i < g.nodes.length; i++)
      g.edges.forEach((e) => {
        if (finishing.has(e.target)) finishing.add(e.source);
      });
    if (finishing.size !== g.nodes.length)
      throw new FlowError("Todo caminho precisa poder terminar em Agente, LLM ou Resposta.");
  }
  const result = structuredClone(g);
  for (const n of result.nodes) if (n.data.kind === "start") n.data.label = "Início";
  return result;
}
// Uma única configuração salva alimenta testes e integrações. Execuções em andamento
// preservam o grafo capturado ao iniciar; publicações antigas passam a usar o grafo salvo.
export function currentFlow(flow: Flow): Flow {
  return { ...flow, version: 1, published: flow.published ? structuredClone(flow.graph) : null };
}
export function listFlows(): Flow[] {
  return (
    db().prepare("SELECT body FROM flows ORDER BY rowid DESC").all() as {
      body: string;
    }[]
  ).map((r) => currentFlow(JSON.parse(r.body)));
}
export function getFlow(id: string): Flow {
  const row = db().prepare("SELECT body FROM flows WHERE id=?").get(id) as
    { body: string } | undefined;
  if (!row) throw new FlowError("Fluxo não encontrado.", 404);
  return currentFlow(JSON.parse(row.body));
}
function putFlow(f: Flow) {
  db()
    .prepare(
      "INSERT INTO flows(id,body) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
    )
    .run(f.id, JSON.stringify(f));
  return f;
}
export function createFlow(name = "Novo fluxo", example = false) {
  const graph = example ? template(true) : { nodes: [block("start", "inicio", 0, 0)], edges: [] };
  return putFlow({
    id: randomUUID(),
    name: name.slice(0, 100),
    description: "",
    graph,
    published: null,
    version: 1,
    updatedAt: new Date().toISOString(),
  });
}
export function createSavedFlow(data: unknown) {
  return writeFlow({ id: randomUUID(), name: "", description: "", graph: { nodes: [], edges: [] }, published: null, version: 1, updatedAt: new Date().toISOString() }, data);
}
export function saveFlow(id: string, data: unknown) {
  return writeFlow(getFlow(id), data);
}
function writeFlow(f: Flow, data: unknown) {
  return putFlow(normalizeFlowUpdate(f, data));
}
/** Pure validation shared by legacy import and the PostgreSQL repository. */
export function normalizeFlowUpdate(f: Flow, data: unknown): Flow {
  if (!data || typeof data !== "object")
    throw new FlowError("Envie os dados do fluxo.");
  const b = data as Partial<Flow>;
  if (
    typeof b.name !== "string" ||
    !b.name.trim() ||
    b.name.length > 100 ||
    typeof b.description !== "string" ||
    b.description.length > 1000
  )
    throw new FlowError("Informe nome e descrição válidos.");
  f.name = b.name.trim();
  f.description = b.description;
  if (b.voiceId !== undefined) {
    if (typeof b.voiceId !== "string" || !/^[a-zA-Z0-9_-]{0,128}$/.test(b.voiceId)) throw new FlowError("Escolha uma voz válida para o fluxo.");
    f.voiceId = b.voiceId;
  }
  // Salvar preserva o trabalho em andamento; a execução valida conexões e configuração.
  f.graph = validateGraph(b.graph);
  f.published = structuredClone(f.graph);
  f.updatedAt = new Date().toISOString();
  return f;
}
export function publishFlow(id: string, active = true) {
  const f = getFlow(id);
  f.published = active ? validateGraph(f.graph, true) : null;
  f.version = 1;
  f.updatedAt = new Date().toISOString();
  return putFlow(f);
}
export function deleteFlow(id: string) {
  getFlow(id);
  if (
    db().prepare("SELECT 1 FROM flow_runs WHERE flow_id=? AND status IN ('running','waiting') LIMIT 1").get(id)
  )
    throw new FlowError(
      "Finalize ou cancele as execuções pendentes antes de excluir.",
      409,
    );
  db().prepare("DELETE FROM flows WHERE id=?").run(id);
}
export function putRun(r: Run) {
  r.updatedAt = new Date().toISOString();
  db()
    .prepare(
      "INSERT INTO flow_runs(id,flow_id,status,body) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,body=excluded.body",
    )
    .run(r.id, r.flowId, r.status, JSON.stringify(r));
  return r;
}
export function getRun(id: string): Run {
  const row = db().prepare("SELECT body FROM flow_runs WHERE id=?").get(id) as
    { body: string } | undefined;
  if (!row) throw new FlowError("Execução não encontrada.", 404);
  return JSON.parse(row.body);
}
export function listRuns(flowId?: string): Run[] {
  const rows = (
    flowId
      ? db()
          .prepare(
            "SELECT body FROM flow_runs WHERE flow_id=? ORDER BY rowid DESC LIMIT 100",
          )
          .all(flowId)
      : db()
          .prepare("SELECT body FROM flow_runs ORDER BY rowid DESC LIMIT 100")
          .all()
  ) as { body: string }[];
  return rows.map((r) => JSON.parse(r.body));
}
export function listRunPage({ page = 1, pageSize = 20, status = "all", flowId }: { page?: number; pageSize?: number; status?: string; flowId?: string } = {}): RunPage {
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)
    throw new FlowError("Use uma página válida e entre 1 e 100 execuções por página.");
  if (!["all", "running", "waiting", "completed", "failed", "cancelled"].includes(status)) throw new FlowError("Escolha um status de execução válido.");
  const filters: string[] = [], params: string[] = [];
  if (flowId) { filters.push("flow_id=?"); params.push(flowId); }
  if (status !== "all") { filters.push("status=?"); params.push(status); }
  const where = filters.length ? ` WHERE ${filters.join(" AND ")}` : "";
  const d = db();
  const total = Number((d.prepare(`SELECT count(*) AS total FROM flow_runs${where}`).get(...params) as { total: number }).total);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const actualPage = Math.min(page, totalPages);
  // Retorna apenas as colunas da lista: grafo, saída e traces são carregados ao abrir o detalhe.
  const rows = d.prepare(`SELECT id,flow_id AS flowId,status,json_extract(body,'$.name') AS name,substr(json_extract(body,'$.input'),1,100) AS input,json_extract(body,'$.demo') AS demo,json_extract(body,'$.createdAt') AS createdAt FROM flow_runs${where} ORDER BY rowid DESC LIMIT ? OFFSET ?`).all(...params,pageSize,(actualPage-1)*pageSize) as (Omit<RunSummary,"demo"> & {demo:number})[];
  return { items: rows.map(row => ({ ...row, demo: !!row.demo })), total, totalPages, page: actualPage, pageSize };
}
export function claimRun(id: string) {
  const r = getRun(id);
  if (r.status !== "waiting")
    throw new FlowError("Esta execução não está aguardando uma decisão.", 409);
  r.status = "running";
  const changed = db()
    .prepare(
      "UPDATE flow_runs SET status='running',body=? WHERE id=? AND status='waiting'",
    )
    .run(JSON.stringify(r), id);
  if (!changed.changes)
    throw new FlowError("Esta decisão já foi recebida.", 409);
  return r;
}
export function interruptRuns() {
  for (const row of db()
    .prepare("SELECT body FROM flow_runs WHERE status='running'")
    .all() as { body: string }[]) {
    const r: Run = JSON.parse(row.body);
    if (r.embedSessionId) continue;
    r.status = "failed";
    r.error =
      "A execução foi interrompida pelo reinício do servidor. Confira as etapas antes de executar novamente.";
    putRun(r);
  }
}
