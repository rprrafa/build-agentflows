import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "agentflows-generator-"));
process.env.DATA_DIR = dir;
const { generateFlow, parseGenerated, GENERATOR_SYSTEM } = await import(
  "./flow-generator"
);
test.after(() => rmSync(dir, { recursive: true, force: true }));
const good = JSON.stringify({
  name: "Triagem de pedidos",
  description: "Classifica e responde pedidos de clientes.",
  nodes: [
    { id: "inicio", kind: "start", label: "Início", config: {} },
    {
      id: "classificador",
      kind: "agent",
      label: "Classificador",
      config: { system: "Classifique a urgência.", prompt: "{{input}}" },
    },
    {
      id: "urgente",
      kind: "condition",
      label: "É urgente?",
      config: { value: "{{last}}", operator: "contains", compare: "urgente" },
    },
    { id: "escala", kind: "approval", label: "Revisar", config: { prompt: "Confirme o encaminhamento." } },
    { id: "fim", kind: "end", label: "Resposta", config: { text: "{{nodes.classificador}}" } },
    { id: "recusado", kind: "end", label: "Encerrar", config: { text: "Encaminhamento não aprovado." } },
  ],
  edges: [
    { source: "inicio", target: "classificador", handle: "ignorado" },
    { source: "classificador", target: "urgente" },
    { source: "urgente", target: "escala", handle: "yes" },
    { source: "urgente", target: "fim", handle: "no" },
    { source: "escala", target: "fim", handle: "yes" },
    { source: "escala", target: "recusado", handle: "no" },
  ],
});
test("resposta válida vira grafo executável com layout e instruções preenchidas", () => {
  const g = parseGenerated("Aqui está:\n```json\n" + good + "\n```");
  assert.equal(g.name, "Triagem de pedidos");
  assert.equal(g.graph.nodes.length, 6);
  assert.equal(g.graph.edges.length, 6);
  const agent = g.graph.nodes.find((n) => n.id === "classificador")!;
  assert.equal(agent.data.config.system, "Classifique a urgência.");
  assert.equal(agent.data.config.model, "");
  assert.equal(g.graph.edges[0].sourceHandle, undefined);
  assert.equal(g.graph.edges[2].sourceHandle, "yes");
  const xs = g.graph.nodes.map((n) => n.position.x);
  assert.ok(new Set(xs).size >= 4);
});
test("resposta sem JSON ou com tipo desconhecido é recusada com diagnóstico", () => {
  assert.throws(() => parseGenerated("não sei"), /formato esperado/);
  assert.throws(
    () =>
      parseGenerated(
        JSON.stringify({ nodes: [{ id: "a", kind: "vetor" }], edges: [] }),
      ),
    /desconhecido/,
  );
  assert.doesNotThrow(
    () =>
      parseGenerated(
        JSON.stringify({
          nodes: [
            { id: "inicio", kind: "start" },
            { id: "a", kind: "agent", config: { prompt: "{{input}}" } },
          ],
          edges: [{ source: "inicio", target: "a" }],
        }),
      ),
  );
});
test("gerador pede correção uma vez e devolve o fluxo corrigido", async () => {
  const calls: string[] = [];
  const g = await generateFlow("Quero triagem de pedidos", async (system, prompt) => {
    calls.push(prompt);
    assert.equal(system, GENERATOR_SYSTEM);
    return calls.length === 1 ? "{ nada }" : good;
  });
  assert.equal(calls.length, 2);
  assert.match(calls[1], /recusada/);
  assert.equal(g.graph.nodes.length, 6);
  await assert.rejects(
    () => generateFlow("x", async () => "sem json"),
    /formato esperado/,
  );
  await assert.rejects(() => generateFlow(""), /Descreva/);
});

test("geração transmite etapas reais e só conclui com um grafo validado, sem salvar o rascunho", async () => {
  const { POST } = await import("../app/api/flows/[id]/generate/route");
  const { chatGPT } = await import("./chatgpt");
  const { listFlows } = await import("./flow-store");
  const bridge = chatGPT(), originalAccount = bridge.account, originalRun = bridge.run;
  let finish!: (answer: string) => void;
  const answer = new Promise<string>((resolve) => { finish = resolve; });
  bridge.account = async () => ({ account: { type: "chatgpt", email: "test@example.com", planType: "plus" }, login: null, error: null });
  bridge.run = async () => answer;
  try {
    const response = await POST(new Request("http://localhost/api/flows/new/generate", {
      method: "POST", headers: { Accept: "application/x-ndjson" }, body: JSON.stringify({ prompt: "Organizar pedidos" }),
    }), { params: Promise.resolve({ id: "new" }) });
    assert.match(response.headers.get("content-type") || "", /application\/x-ndjson/);
    const reader = response.body!.getReader(), decoder = new TextDecoder();
    assert.deepEqual(JSON.parse(decoder.decode((await reader.read()).value)), { phase: "interpreting" });
    assert.deepEqual(JSON.parse(decoder.decode((await reader.read()).value)), { phase: "planning" });
    finish(good);
    let remaining = "";
    while (true) { const chunk = await reader.read(); if (chunk.done) break; remaining += decoder.decode(chunk.value); }
    const events = remaining.trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(events[0].phase, "creating");
    assert.deepEqual(events[1].result, parseGenerated(good));
    assert.equal(listFlows().length, 0);

    bridge.run = async () => "resposta inválida";
    const failed = await POST(new Request("http://localhost/api/flows/new/generate", {
      method: "POST", headers: { Accept: "application/x-ndjson" }, body: JSON.stringify({ prompt: "Organizar pedidos" }),
    }), { params: Promise.resolve({ id: "new" }) });
    const failedEvents = (await failed.text()).trim().split("\n").map((line) => JSON.parse(line));
    assert.ok(failedEvents.some((event) => event.phase === "repairing"));
    assert.ok(failedEvents.at(-1).error);
    assert.ok(!failedEvents.some((event) => event.result));
  } finally { finish(good); bridge.account = originalAccount; bridge.run = originalRun; }
});
