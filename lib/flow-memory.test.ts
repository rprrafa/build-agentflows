import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "agentflows-memory-"));
process.env.DATA_DIR = dir;
const { createFlow, saveFlow, getFlow, getRun, validateGraph } = await import("./flow-store");
const { prepareRun, execute, startRun } = await import("./flow-runtime");
const { block } = await import("./flow-types");
const { memoryMessages, memoryPrompt } = await import("./flow-memory");
const { conversationHistory } = await import("./conversation");
const { chatGPT } = await import("./chatgpt");
const bridge = chatGPT();
bridge.account = async () => ({ account: { type: "chatgpt", email: "fixture@example.com", planType: "plus" }, login: null, error: null });
test.after(() => rmSync(dir, { recursive: true, force: true }));

function flow() {
  const created = createFlow("Memória");
  const nodes = [block("start", "inicio", 0, 0), block("agent", "a", 0, 0), block("llm", "b", 0, 0), block("agent", "c", 0, 0)];
  return saveFlow(created.id, { ...created, graph: { nodes, edges: nodes.slice(1).map((node, i) => ({ id: `e${i}`, source: nodes[i].id, target: node.id })) } });
}
const noSummary = async () => { throw new Error("Não deveria resumir"); };

test("Agente e LLM novos e antigos recebem a conversa e todas as respostas anteriores por padrão", async () => {
  const f = flow();
  assert.equal(f.graph.nodes[1].data.config.memoryType, "allMessages");
  assert.equal(f.graph.nodes[2].data.config.memoryType, "allMessages");
  delete f.graph.nodes[2].data.config.memoryType;
  saveFlow(f.id, f);
  const prompts: string[] = [];
  bridge.run = async ({ prompt }) => { prompts.push(prompt); return ["Resultado exclusivo A", "Resultado exclusivo B", "Conclusão C"][prompts.length - 1]; };
  const run = await prepareRun(f.id, "Pedido original", false, false);
  run.conversation = [{ input: "Pergunta passada", output: "Resposta passada" }];
  const result = await execute(run);
  assert.equal(result.status, "completed");
  assert.equal(prompts.length, 3);
  for (const prompt of prompts) {
    assert.match(prompt, /Pedido original/);
    assert.match(prompt, /Pergunta passada/);
    assert.match(prompt, /Resposta passada/);
  }
  assert.match(prompts[1], /Resultado exclusivo A/);
  assert.match(prompts[2], /Resultado exclusivo A/);
  assert.match(prompts[2], /Resultado exclusivo B/);
  assert.equal((prompts[1].match(/Resultado exclusivo A/g) || []).length, 1);
  assert.equal((prompts[2].match(/Resultado exclusivo B/g) || []).length, 1);
  assert.equal(getRun(result.id).trace.filter((entry) => entry.type === "step").length, 4);
});

test("memória desligada isola o contexto do bloco, mas sua resposta continua disponível aos próximos", async () => {
  const f = flow();
  f.graph.nodes[2].data.config.memoryEnabled = "false";
  f.graph.nodes[2].data.config.prompt = "Tarefa independente";
  saveFlow(f.id, f);
  assert.equal(getFlow(f.id).graph.nodes[2].data.config.memoryEnabled, "false");
  const prompts: string[] = [];
  bridge.run = async ({ prompt }) => { prompts.push(prompt); return "Resposta " + prompts.length; };
  const result = await startRun(f.id, "Pedido original", false, false);
  assert.equal(result.status, "completed");
  assert.equal(prompts[1], "Tarefa independente");
  assert.match(prompts[2], /Pedido original/);
  assert.match(prompts[2], /Resposta 1/);
  assert.match(prompts[2], /Resposta 2/);
});

test("janela limita mensagens anteriores sem cortar mensagem da etapa, instruções ou referências", async () => {
  const f = flow();
  f.graph.nodes[2].data.config = { ...f.graph.nodes[2].data.config, memoryType: "windowSize", memoryWindowSize: "1", system: "Regra importante", prompt: "Revise {{last}}" };
  saveFlow(f.id, f);
  const calls: { prompt: string; system: string }[] = [];
  bridge.run = async ({ prompt, system }) => { calls.push({ prompt, system }); return "Resposta " + calls.length; };
  const result = await startRun(f.id, "Mensagem antiga", false, false);
  assert.equal(result.status, "completed");
  assert.doesNotMatch(calls[1].prompt, /Mensagem antiga/);
  assert.match(calls[1].prompt, /Resposta 1/);
  assert.ok(calls[1].prompt.endsWith("Revise Resposta 1"));
  assert.equal(calls[1].system, "Regra importante");
});

test("resumo usa o mesmo modelo, sem ferramentas, e não substitui as respostas armazenadas", async () => {
  const f = flow();
  f.graph.nodes[2].data.config.memoryType = "conversationSummary";
  f.graph.nodes[2].data.config.model = "modelo-do-resumo";
  saveFlow(f.id, f);
  const calls: Parameters<typeof bridge.run>[0][] = [];
  bridge.run = async (args) => {
    calls.push(args);
    if (args.system.startsWith("Resuma o histórico")) return "Resumo preparado";
    return "Resposta " + calls.length;
  };
  const result = await startRun(f.id, "Fato a resumir", false, false);
  assert.equal(result.status, "completed");
  assert.equal(calls.length, 4);
  assert.equal(calls[1].model, "modelo-do-resumo");
  assert.deepEqual(calls[1].tools, []);
  assert.equal(calls[1].webSearch, false);
  assert.ok(calls[1].signal);
  assert.equal(calls[1].onText, undefined);
  assert.match(calls[2].prompt, /Resumo preparado/);
  assert.doesNotMatch(calls[2].prompt, /Fato a resumir/);
  assert.ok(calls[2].prompt.endsWith("Resposta 1"));
  assert.match(calls[3].prompt, /Fato a resumir/);
  assert.doesNotMatch(calls[3].prompt, /Resumo preparado/);
});

test("resumo com recentes só resume o excesso, preserva a ordem e mantém a mensagem atual", async () => {
  const run = await prepareRun(flow().id, "Mensagem atual", false, false);
  run.conversation = [{ input: "Antiga " + "x".repeat(1000), output: "Recente" }];
  let summarized = "";
  const prompt = await memoryPrompt(run, { memoryType: "conversationSummaryBuffer", memoryMaxTokens: "100" }, run.input, async (history) => { summarized = history; return "Resumo antigo"; });
  assert.match(summarized, /Antiga/);
  assert.doesNotMatch(summarized, /Recente|Mensagem atual/);
  assert.match(prompt, /Resumo antigo/);
  assert.match(prompt, /Recente/);
  assert.doesNotMatch(prompt, /x{100}/);
  assert.ok(prompt.endsWith("Mensagem atual"));
  run.conversation = [{ input: "Curta", output: "Também curta" }];
  assert.match(await memoryPrompt(run, { memoryType: "conversationSummaryBuffer", memoryMaxTokens: "100" }, run.input, noSummary), /Também curta/);
  run.conversation = [];
  assert.equal(await memoryPrompt(run, { memoryType: "conversationSummary" }, run.input, noSummary), "Mensagem atual");
});

test("memória preserva passagens repetidas e exclui chamadas internas de ferramentas", async () => {
  const run = await prepareRun(flow().id, "Pedido", false, false);
  const entry = { nodeId: "a", label: "Agente", output: "Primeira passagem", at: "", ms: 1 };
  run.trace = [entry, { ...entry, type: "tool", label: "Ferramenta: busca", output: "Detalhe interno" }, { ...entry, type: "step", output: "Segunda passagem" }];
  const messages = memoryMessages(run);
  assert.deepEqual(messages.map((m) => m.content), ["Pedido", "Primeira passagem", "Segunda passagem"]);
});

test("histórico aceita mais de seis interações e preserva textos longos", async () => {
  const f = flow();
  const input = "Pergunta " + "a".repeat(1200);
  const output = "Resposta " + "b".repeat(4500);
  bridge.run = async () => output;
  const ids: string[] = [];
  for (let i = 0; i < 7; i++) ids.push((await startRun(f.id, input, false, false)).id);
  const history = conversationHistory(f.id, ids);
  assert.equal(history.length, 7);
  assert.equal(history[0].input, input);
  assert.equal(history[6].output, output);
});

test("salvamento rejeita tipos e limites inválidos; falhas no resumo não são ignoradas", async () => {
  for (const config of [{ memoryType: "inexistente" }, { memoryType: "windowSize", memoryWindowSize: "0" }, { memoryType: "windowSize", memoryWindowSize: "2.5" }, { memoryType: "conversationSummaryBuffer", memoryMaxTokens: "abc" }]) {
    const f = flow();
    Object.assign(f.graph.nodes[1].data.config, config);
    assert.throws(() => validateGraph(f.graph), /memória|mensagens|tokens/);
  }
  const f = flow();
  f.graph.nodes[2].data.config.memoryType = "conversationSummary";
  saveFlow(f.id, f);
  bridge.run = async ({ system }) => { if (system.startsWith("Resuma")) throw new Error("Provedor indisponível"); return "Resposta A"; };
  const result = await startRun(f.id, "Pedido", false, false);
  assert.equal(result.status, "failed");
  assert.equal(result.error, "Provedor indisponível");
  assert.equal(result.outputs.b, undefined);
});

test("chat conserva o nome entre mensagens e inicia sem histórico após limpar a conversa", async () => {
  const { POST } = await import("../app/api/flows/[id]/run/route");
  const f = flow(), prompts: string[] = [];
  bridge.run = async ({ prompt }) => { prompts.push(prompt); return "Resposta do agente"; };
  const send = async (input: string, conversationRunIds: string[]) => {
    const response = await POST(new Request(`http://localhost/api/flows/${f.id}/run`, {
      method: "POST", body: JSON.stringify({ input, conversationRunIds }),
    }), { params: Promise.resolve({ id: f.id }) });
    assert.equal(response.status, 200);
    return response.json();
  };
  const first = await send("Meu nome é Rafael", []);
  prompts.length = 0;
  await send("Sabe meu nome?", [first.id]);
  assert.equal(prompts.length, 3);
  for (const prompt of prompts) assert.match(prompt, /Meu nome é Rafael/);
  prompts.length = 0;
  await send("Nova conversa", []);
  for (const prompt of prompts) assert.doesNotMatch(prompt, /Rafael|Sabe meu nome/);
});
