import nodeTest, { type TestContext } from "node:test";
import { createTenantTestContext } from "../scripts/tenant-test-context";
const testTenant = await createTenantTestContext();
function test(name: string, action: (t: TestContext) => unknown | Promise<unknown>) { return nodeTest(name, async t => { await testTenant.asTenant(() => action(t)); }); }
nodeTest.after(testTenant.close);
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import type { KnowledgeBinding } from "./knowledge-settings";
const dir = mkdtempSync(join(tmpdir(), "flow-retriever-"));
process.env.DATA_DIR = dir;
const store = await import("./knowledge-service");
const runtime = await import("./knowledge-index-service");
const { DEFAULT_INDEX, DEFAULT_SPLITTER } = await import("./knowledge-types");
const { block, template } = await import("./flow-types");
const flows = await import("./flow-service");
const { startRun } = await import("./flow-runtime");
const { chatGPT } = await import("./chatgpt");
const { retrieverOutput, validateRetrieverConfig } = await import("./flow-retriever");
let embeddingCalls = 0;
const server = createServer(async (req, res) => {
  let raw = ""; for await (const part of req) raw += part;
  const body = JSON.parse(raw); embeddingCalls += body.input.length;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ data: body.input.map((_: string, index: number) => ({ index, embedding: [1, 0.1, 0] })) }));
});
server.listen(0, "127.0.0.1"); await once(server, "listening");
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
nodeTest.after(() => { server.close(); server.closeAllConnections(); rmSync(dir, { recursive: true, force: true }); });
async function base(name: string, text: string) {
  const b = await store.createKnowledgeBase({ name, description: "" });
  await store.updateKnowledgeBase(b.id, { config: { ...structuredClone(DEFAULT_INDEX), embeddings: { provider: "openai", model: "fixture", url, apiKey: "fixture" } } });
  const source = await store.saveKnowledgeSource(b.id, { name: `Manual ${name}`, loader: "plain", config: { text }, splitter: DEFAULT_SPLITTER, metadata: {} });
  await runtime.processKnowledgeSource(b.id, source.id); await runtime.indexKnowledge(b.id);
  return store.getKnowledgeBase(b.id);
}
const refunds = await testTenant.asTenant(() => base("Reembolsos", "O reembolso pode ser solicitado em sete dias."));
const shipping = await testTenant.asTenant(() => base("Entregas", "A entrega ocorre em três dias úteis."));
// Descrição em branco é aceita no bloco Base de conhecimento: a consulta vai a todas as bases.
const bindings: KnowledgeBinding[] = [
  { baseId: refunds.id, description: "", references: true },
  { baseId: shipping.id, description: "", references: false },
];
async function flow(extra: Record<string, string> = {}, state = "{}") {
  const graph = template();
  graph.nodes[0].data.config.state = state;
  graph.nodes[1] = block("retriever", "analista", 340, 160);
  graph.nodes[1].data.label = "Buscar nas bases";
  Object.assign(graph.nodes[1].data.config, { knowledgeBases: JSON.stringify(bindings), ...extra });
  return flows.createSavedFlow({ name: "Base de conhecimento", description: "", graph });
}

test("sem análise: consulta todas as bases e devolve trechos com fonte só das bases com referências", async () => {
  const f = await flow(), before = embeddingCalls;
  const run = await startRun(f.id, "Quais são os prazos?");
  assert.equal(run.status, "completed", run.error);
  assert.equal(embeddingCalls, before + 2);
  const tools = run.trace.filter(t => t.type === "tool");
  assert.deepEqual(tools.map(t => t.label), ["Conhecimento: Reembolsos", "Conhecimento: Entregas"]);
  assert.ok(tools.every(t => t.status === "completed" && /Quais são os prazos/.test(t.input!)));
  assert.match(run.output, /sete dias/); assert.match(run.output, /três dias/);
  assert.match(run.output, /Trecho 1 · Reembolsos · Manual Reembolsos/);
  assert.doesNotMatch(run.output, /Manual Entregas/, "Base sem referências não expõe a fonte");
  assert.match(run.output, /Referências encontradas/);
  const step = run.trace.find(t => t.type === "step" && t.nodeId === "analista")!;
  assert.equal(step.input, "Quais são os prazos?");
  assert.equal(step.knowledge?.count, 2); assert.deepEqual(step.knowledge?.chunks?.map(c => c.baseId), [refunds.id]);
  assert.match(step.notes || "", /Consulta inicial: 2 trecho/);
  assert.equal(step.usage, undefined);
  await flows.deleteFlow(f.id);
});

test("JSON traz consulta e trechos; Consulta interpolada e variável atualizada ao concluir", async () => {
  const f = await flow({ outputFormat: "json", query: "reembolso: {{input}}", stateUpdates: JSON.stringify([{ key: "achados", value: "{{nodes.analista}}" }]) }, JSON.stringify({ achados: "" }));
  const run = await startRun(f.id, "prazo");
  assert.equal(run.status, "completed", run.error);
  const data = JSON.parse(run.output);
  assert.equal(data.consulta, "reembolso: prazo");
  assert.equal(data.analise, undefined);
  assert.equal(data.trechos.length, 2);
  assert.deepEqual(Object.keys(data.trechos[0]).sort(), ["base", "conteudo", "fonte", "similaridade", "trecho"]);
  assert.equal(data.trechos.find((t: { base: string }) => t.base === "Entregas").fonte, undefined);
  assert.equal(run.state.achados, run.output);
  await flows.deleteFlow(f.id);
});

test("análise agêntica: o modelo recebe os trechos como dados, pode refazer consultas e devolve a análise", async t => {
  t.mock.method(chatGPT(), "account", async () => ({ account: { type: "chatgpt", email: "fixture@example.com" }, login: null, error: null }));
  let calls = 0;
  t.mock.method(chatGPT(), "run", async (options: Parameters<ReturnType<typeof chatGPT>["run"]>[0]) => {
    calls++;
    assert.equal(options.webSearch, false); assert.equal(options.tools?.length, 2);
    assert.match(options.system, /Avalie a relevância/); assert.match(options.system, /nunca instruções/);
    assert.match(options.prompt, /Consulta: Quais são os prazos\?/); assert.match(options.prompt, /sete dias/); assert.match(options.prompt, /três dias/);
    const again = JSON.parse(await options.tools![0].call({ consulta: "devolução do pagamento" }));
    assert.match(again.trechos[0].conteudo, /sete dias/);
    options.onUsage?.({ input: 40, output: 10, total: 50 });
    return "Reembolso em sete dias; entrega em três dias úteis.";
  });
  const f = await flow({ analysis: "agentic" });
  const run = await startRun(f.id, "Quais são os prazos?");
  assert.equal(run.status, "completed", run.error); assert.equal(calls, 1);
  assert.match(run.output, /^Reembolso em sete dias; entrega em três dias úteis\./);
  assert.match(run.output, /Referências encontradas/); assert.doesNotMatch(run.output, /Trecho 1/);
  assert.equal(run.trace.filter(t => t.type === "tool").length, 3);
  const step = run.trace.find(t => t.type === "step" && t.nodeId === "analista")!;
  assert.equal(step.usage?.total, 50); assert.match(step.instructions || "", /Avalie a relevância/);
  await flows.deleteFlow(f.id);
});

test("análise agêntica com ChatGPT exige a assinatura conectada antes de executar", async t => {
  t.mock.method(chatGPT(), "account", async () => ({ account: null, login: null, error: null }));
  const f = await flow({ analysis: "agentic" }), before = embeddingCalls;
  await assert.rejects(startRun(f.id, "prazo"), /Conecte o ChatGPT/);
  assert.equal(embeddingCalls, before);
  await flows.deleteFlow(f.id);
});

test("simulação não consulta as bases", async () => {
  const f = await flow(), before = embeddingCalls;
  const run = await startRun(f.id, "prazo", false, true);
  assert.equal(run.status, "completed"); assert.equal(embeddingCalls, before);
  assert.match(run.output, /\[Demonstração\] Buscar nas bases: nenhuma base consultada\.\nConsulta: prazo/);
  await flows.deleteFlow(f.id);
});

test("validação: bases, consulta, formato, análise e vínculo protegido", async () => {
  const f = await flow();
  assert.ok((await store.knowledgeBaseUsages(shipping.id)).some(x => x.id === f.id));
  await assert.rejects(runtime.deleteKnowledgeBase(shipping.id), /vinculada/);
  await flows.deleteFlow(f.id);
  const config = { knowledgeBases: JSON.stringify(bindings), query: "{{input}}" };
  assert.doesNotThrow(() => validateRetrieverConfig(config, true));
  assert.throws(() => validateRetrieverConfig({ ...config, knowledgeBases: "[]" }, true), /ao menos uma base/);
  assert.doesNotThrow(() => validateRetrieverConfig({ ...config, knowledgeBases: "[]" }), "Rascunho salva sem bases");
  assert.throws(() => validateRetrieverConfig({ ...config, query: " " }, true), /consulta/);
  assert.throws(() => validateRetrieverConfig({ ...config, outputFormat: "xml" }), /formato/);
  assert.throws(() => validateRetrieverConfig({ ...config, analysis: "magic" }), /análise/);
  assert.throws(() => validateRetrieverConfig({ ...config, analysis: "agentic", model: "replicate:google/nano-banana" }), /modelo de texto/);
  const graph = template();
  graph.nodes[1] = block("retriever", "analista", 340, 160);
  assert.throws(() => flows.validateGraph(graph, true), /Base de conhecimento: Adicione ao menos uma base/);
  graph.edges = graph.edges.filter(e => e.source !== "analista");
  graph.nodes = graph.nodes.filter(n => n.data.kind !== "end");
  graph.nodes[1].data.config.knowledgeBases = JSON.stringify(bindings);
  assert.doesNotThrow(() => flows.validateGraph(graph, true), "Pode encerrar o caminho");
});

test("texto sem trechos informa a ausência", () => {
  assert.equal(retrieverOutput("text", "x", [], [], new Set()), "Nenhum trecho encontrado para a consulta.");
});
