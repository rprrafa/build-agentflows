import nodeTest, { type TestContext } from "node:test";
import { createTenantTestContext } from "../scripts/tenant-test-context";
const testTenant = await createTenantTestContext();
function test(name: string, action: (t: TestContext) => unknown | Promise<unknown>) { return nodeTest(name, async t => { await testTenant.asTenant(() => action(t)); }); }
nodeTest.after(testTenant.close);
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const dir = mkdtempSync(join(tmpdir(), "agentflows-conversation-")); process.env.DATA_DIR = dir;
const { createFlow, saveFlow, getFlow } = await import("./flow-service");
const { startRun } = await import("./flow-runtime");
const { tenantConversationHistory: conversationHistory } = await import("./conversation");
const { chatGPT } = await import("./chatgpt");
const { template } = await import("./flow-types");
const bridge = await testTenant.asTenant(chatGPT); bridge.account = async () => ({ account: { type: "chatgpt", email: "fixture@example.com", planType: "plus" }, login: null, error: null });
bridge.run = async () => "Ana escolheu o plano Azul.";
nodeTest.after(() => rmSync(dir, { recursive: true, force: true }));
test("pergunta de continuidade recebe contexto do mesmo fluxo sem alterar a entrada atual", async () => {
  const flow = (await createFlow("Conversa"));
  const graph = template();
  graph.nodes = graph.nodes.filter((node) => node.data.kind !== "end");
  graph.edges = graph.edges.filter((edge) => edge.target !== "resposta");
  (await saveFlow(flow.id, { ...flow, graph }));
  const first = await startRun(flow.id, "Ana escolheu Azul", false, false);
  bridge.run = async ({ prompt }) => { assert.match(prompt, /Ana escolheu o plano Azul/); assert.match(prompt, /Qual plano ela escolheu/); return "Azul"; };
  const second = await startRun(flow.id, "Qual plano ela escolheu?", false, false, [], [first.id]);
  assert.equal(second.status, "completed"); assert.equal(second.input, "Qual plano ela escolheu?"); assert.equal(second.conversation?.length, 1);
  const other = (await createFlow("Outro")); await assert.rejects(async () => (await conversationHistory(other.id, [first.id])), /deste fluxo/);
  await assert.rejects(async () => (await conversationHistory(flow.id, [first.id, first.id])), /inválido/);
  await assert.rejects(async () => (await conversationHistory(flow.id, Array.from({ length: 1001 }, (_, i) => String(i)))), /mil interações/);
  const demo = await startRun(flow.id, "Demo", false, true); await assert.rejects(async () => (await conversationHistory(flow.id, [demo.id])), /concluídas/);
});
test("voz pertence ao fluxo, persiste ao reabrir e sobrevive ao salvamento de cliente anterior", async () => {
  const flow = (await createFlow("Voz")); (await saveFlow(flow.id, { ...flow, voiceId: "voz-portugues" }));
  assert.equal((await getFlow(flow.id)).voiceId, "voz-portugues"); (await saveFlow(flow.id, { ...flow, name: "Renomeado" })); assert.equal((await getFlow(flow.id)).voiceId, "voz-portugues");
  await assert.rejects(async () => (await saveFlow(flow.id, { ...flow, voiceId: "../segredo" })), /voz válida/);
  (await saveFlow(flow.id, { ...flow, voiceId: "" })); assert.equal((await getFlow(flow.id)).voiceId, "");
});
