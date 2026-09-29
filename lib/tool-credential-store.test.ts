import nodeTest, { type TestContext } from "node:test";
import { createTenantTestContext, commitTestConfig } from "../scripts/tenant-test-context";
const testTenant = await createTenantTestContext();
function test(name: string, action: (t: TestContext) => unknown | Promise<unknown>) { return nodeTest(name, async t => { await testTenant.asTenant(() => action(t)); }); }
nodeTest.after(testTenant.close);
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "agentflows-credentials-")); process.env.DATA_DIR = dir;
const credentials = await import("./tool-credential-store");
const { getConfig, setConfig } = await import("./store");
const { resolveTools } = await import("./tools");
const { toolConfig, setToolConfig } = await import("./tool-config-context");
const { readToolCards, replaceToolCard } = await import("./agent-tools");
const { createFlow, saveFlow, validateGraph, getRun } = await import("./flow-service");
const { template } = await import("./flow-types");
const { startRun } = await import("./flow-runtime");
const { chatGPT } = await import("./chatgpt");
const { GET, POST } = await import("../app/api/tool-credentials/route");
nodeTest.after(() => rmSync(dir, { recursive: true, force: true }));
const create = (name: string, token: string, provider = "tavily") => credentials.saveToolCredential({ name, provider, fields: { [provider === "tavily" ? "TOOL_TAVILY_KEY" : "TOOL_SERPER_KEY"]: token } });
const cards = (id: string, target = "interno:tavily") => JSON.stringify([{ id: "card", kind: "tool", target, credentialId: id }]);

test("credenciais nomeadas cifram valores, nunca devolvem segredos e preservam chaves ao editar", async () => {
  const c = create("Comercial", "chave-secreta-comercial");
  assert.equal(c.configured, true);
  assert.equal(c.fields[0].valor, undefined);
  assert.ok(!JSON.stringify(credentials.listToolCredentials()).includes("chave-secreta"));
  await commitTestConfig();
  const raw = (await testTenant.db.query<{ ciphertext: string }>("SELECT ciphertext FROM credentials WHERE user_id=$1 AND key=$2", [testTenant.owner, `TOOL_ACCOUNT_${c.id}`])).rows[0];
  assert.match(raw.ciphertext, /^v2:/); assert.ok(!raw.ciphertext.includes("chave-secreta"));
  const saved = credentials.saveToolCredential({ name: "Vendas", fields: { TOOL_TAVILY_KEY: "" } }, c.id);
  assert.equal(saved.name, "Vendas");
  assert.equal(credentials.withToolCredential(c.id, "tavily", () => toolConfig("TOOL_TAVILY_KEY")), "chave-secreta-comercial");
  assert.throws(() => create("Vendas", "outro"), /Já existe/);
  assert.throws(() => credentials.saveToolCredential({ name: "Vendas", provider: "serper", fields: {} }, c.id), /não pode ser alterado/);
  assert.throws(() => credentials.saveToolCredential({ name: "Outra", provider: "tavily", fields: { OPENAI_API_KEY: "não permitido" } }), /inválidos/);
});

test("duas ferramentas simultâneas usam suas contas, sem alterar a conexão global", async () => {
  setConfig("TOOL_TAVILY_KEY", "conta-padrao");
  const a = create("Equipe A", "token-a"), b = create("Equipe B", "token-b");
  const [ta] = await resolveTools(["interno:tavily"], cards(a.id));
  const [tb] = await resolveTools(["interno:tavily"], cards(b.id));
  const original = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(init?.body as string);
    await new Promise((r) => setTimeout(r, payload.api_key === "token-a" ? 10 : 1));
    seen.push(payload.api_key);
    return Response.json({ results: [{ title: payload.api_key }] });
  };
  try {
    const [outA, outB] = await Promise.all([ta.call({ consulta: "A" }), tb.call({ consulta: "B" })]);
    assert.match(outA, /token-a/); assert.match(outB, /token-b/);
    assert.deepEqual(seen.sort(), ["token-a", "token-b"]);
  } finally { globalThis.fetch = original; }
  assert.equal(getConfig("TOOL_TAVILY_KEY"), "conta-padrao");
  assert.equal(toolConfig("TOOL_TAVILY_KEY"), "conta-padrao");
  await assert.rejects(() => resolveTools(["interno:serper"], cards(a.id, "interno:serper")), /não pertence/);
  await assert.rejects(() => resolveTools(["interno:tavily"], cards("00000000-0000-0000-0000-000000000000")), /não existe/);
});

test("campos ausentes não herdam dados globais e renovação OAuth atualiza só a conta escolhida", () => {
  setConfig("TOOL_GOOGLE_REFRESH_TOKEN", "global-refresh");
  const c = credentials.saveToolCredential({ name: "Agenda", provider: "google_workspace", fields: { TOOL_GOOGLE_TOKEN: "token-local" } });
  credentials.withToolCredential(c.id, "google_workspace", () => {
    assert.equal(toolConfig("TOOL_GOOGLE_REFRESH_TOKEN"), undefined);
    setToolConfig("TOOL_GOOGLE_TOKEN", "renovado");
    setToolConfig("TOOL_GOOGLE_EXPIRES_AT", "123456789");
  });
  credentials.withToolCredential(c.id, "google_workspace", () => {
    assert.equal(toolConfig("TOOL_GOOGLE_TOKEN"), "renovado");
    assert.equal(toolConfig("TOOL_GOOGLE_EXPIRES_AT"), "123456789");
  });
  assert.equal(getConfig("TOOL_GOOGLE_REFRESH_TOKEN"), "global-refresh");
  assert.equal(getConfig("TOOL_GOOGLE_EXPIRES_AT"), undefined);
});

test("conexões pertencem ao usuário e não herdam chaves do ambiente", () => {
  assert.ok(credentials.listToolCredentials("tavily").every(c => !c.id.startsWith("default:")));
  assert.throws(() => credentials.getToolCredential("default:tavily"), /não existe/);
  process.env.TOOL_TAVILY_KEY = "definida-no-servidor";
  try {
    const c = create("Independente do ambiente", "minha-chave");
    assert.equal(credentials.withToolCredential(c.id, "tavily", () => toolConfig("TOOL_TAVILY_KEY")), "minha-chave");
  } finally { delete process.env.TOOL_TAVILY_KEY; }
});

test("salvar/reabrir preserva o vínculo, trocar ferramenta remove a conta anterior e uso impede exclusão", async () => {
  const c = create("Selecionada", "segredo-de-teste");
  await commitTestConfig();
  const f = (await createFlow("Credenciais")); const graph = template();
  graph.nodes[1].data.config.tools = "interno:tavily";
  graph.nodes[1].data.config.toolCards = cards(c.id);
  const saved = (await saveFlow(f.id, { ...f, graph }));
  const selected = readToolCards("interno:tavily", saved.graph.nodes[1].data.config.toolCards);
  assert.equal(selected[0].credentialId, c.id);
  assert.ok(!JSON.stringify(saved).includes("segredo-de-teste"));
  await assert.rejects(async () => { credentials.deleteToolCredential(c.id); await commitTestConfig(); }, /em uso/);
  const switched = replaceToolCard(["interno:tavily"], selected, "card", "interno:serper");
  assert.equal(switched.cards[0].credentialId, undefined);
  const invalid = structuredClone(graph);
  invalid.nodes[1].data.config.toolCards = JSON.stringify([{ id: "c", kind: "tool", target: "interno:tavily", credentialId: 123 }]);
  assert.throws(() => validateGraph(invalid), /credenciais/);
  (await saveFlow(f.id, { ...saved, graph: template() }));
  credentials.deleteToolCredential(c.id);
  assert.throws(() => credentials.getToolCredential(c.id), /não existe/);
  assert.equal(getConfig(`TOOL_ACCOUNT_${c.id}`), undefined);
});

test("motor do Agente usa a credencial salva no cartão e expõe só a ferramenta autorizada", async () => {
  const c = create("Execução", "token-execucao");
  await commitTestConfig();
  const f = (await createFlow("Execução")); const graph = template();
  graph.nodes[1].data.config.tools = "interno:tavily";
  graph.nodes[1].data.config.toolCards = cards(c.id);
  (await saveFlow(f.id, { ...f, graph }));
  const bridge = chatGPT();
  bridge.account = async () => ({ account: { type: "chatgpt", email: "fixture@example.com", planType: "plus" }, login: null, error: null });
  bridge.run = async ({ tools = [] }) => { assert.deepEqual(tools.map((t) => t.name), ["tavily"]); return tools[0].call({ consulta: "teste" }); };
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => { assert.equal(JSON.parse(init?.body as string).api_key, "token-execucao"); return Response.json({ results: [{ title: "Resultado correto" }] }); };
  try { const result = await startRun(f.id, "Pesquise", false, false); assert.equal(result.status, "completed"); assert.match((await getRun(result.id)).output, /Resultado correto/); }
  finally { globalThis.fetch = original; }
});

nodeTest("API cria e lista credenciais sem incluir chaves na resposta", async (t) => {
  const tenant = await (await import("../scripts/tenant-test-context")).createTenantTestContext(); t.after(tenant.close);
  const response = await tenant.connect(() => POST(tenant.request("/api/tool-credentials", { method: "POST", body: JSON.stringify({ name: "Via API", provider: "serper", fields: { TOOL_SERPER_KEY: "segredo-api" } }) })));
  assert.equal(response.status, 200);
  const created = await response.json(); assert.ok(created.id); assert.ok(!JSON.stringify(created).includes("segredo-api"));
  const list = await tenant.connect(() => GET(tenant.request("/api/tool-credentials?provider=serper")));
  assert.equal(list.status, 200); const data = await list.json(); assert.ok(data.some((c: { id: string }) => c.id === created.id));
  assert.ok(!JSON.stringify(data).includes("segredo-api"));
});
