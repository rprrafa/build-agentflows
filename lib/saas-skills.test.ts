import nodeTest, { type TestContext } from "node:test";
import { createTenantTestContext } from "../scripts/tenant-test-context";
const testTenant = await createTenantTestContext();
function test(name: string, action: (t: TestContext) => unknown | Promise<unknown>) { return nodeTest(name, async t => { await testTenant.asTenant(() => action(t)); }); }
nodeTest.after(testTenant.close);
import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import { template } from "./flow-types";
const flows = await import("./flow-service");
const { buildRun, startRun } = await import("./flow-runtime");
const { setConfig } = await import("./store");
const { currentTenant } = await import("./tenant-context");
const { deleteSkill, getSkill, listSkills, saveSkill } = await import("./skill-service");
const { portableGraph } = await import("./flow-portable");

const markdown = (name: string, body = "Use parágrafos curtos e assine como Equipe.") =>
  `---\nname: ${name}\ndescription: Formata e-mails de resposta. Use quando pedirem um e-mail.\n---\n${body}`;

async function flowWith(skills: string, name = "Com habilidade") {
  const graph = template();
  graph.nodes[1].data.config = { ...graph.nodes[1].data.config, model: "openrouter:fixture", tools: "", skills };
  return flows.createSavedFlow({ name, description: "", graph });
}

test("envio de SKILL.md e .zip; mesmo name atualiza a habilidade e mantém o id", async () => {
  const first = await saveSkill(new File([markdown("formatar-email")], "SKILL.md"));
  assert.equal(first.replaced, false);
  assert.ok(first.headerTokens > 0 && first.bodyTokens > 0);
  const again = await saveSkill(new File([markdown("formatar-email", "Nova versão.")], "SKILL.md"));
  assert.equal(again.id, first.id);
  assert.equal(again.replaced, true);
  assert.equal((await getSkill(first.id)).body, "Nova versão.");
  const zip = zipSync({ "triagem/SKILL.md": strToU8(markdown("triagem")), "triagem/references/regras.md": strToU8("Regra 1.") });
  const packaged = await saveSkill(new File([zip], "triagem.zip"));
  assert.deepEqual(packaged.files, ["references/regras.md"]);
  assert.deepEqual((await listSkills()).map((skill) => skill.name), ["formatar-email", "triagem"]);
  await assert.rejects(() => saveSkill(new File(["# sem cabeçalho"], "SKILL.md")), /cabeçalho YAML/);
  await deleteSkill(packaged.id);
});

test("agente recebe só o catálogo; carrega a habilidade sob demanda, repetição não reenvia o conteúdo", async (t) => {
  const skill = (await listSkills()).find((item) => item.name === "formatar-email")!;
  setConfig("OPENROUTER_API_KEY", "fixture");
  let rounds = 0;
  t.mock.method(globalThis, "fetch", async (_target: string, options: RequestInit) => {
    const payload = JSON.parse(String(options.body));
    rounds++;
    const system = payload.messages[0].content as string;
    assert.match(system, /<habilidades_disponiveis>\n- formatar-email: Formata e-mails/);
    assert.doesNotMatch(system, /Nova versão/);
    assert.equal(payload.tools.length, 1);
    assert.equal(payload.tools[0].function.name, "usar_habilidade");
    const results = payload.messages.filter((m: { role: string }) => m.role === "tool");
    const call = (id: string) => ({ id, type: "function", function: { name: "usar_habilidade", arguments: JSON.stringify({ nome: "formatar-email" }) } });
    if (results.length === 0) return Response.json({ choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [call("a")] } }], usage: { prompt_tokens: 40, completion_tokens: 5, total_tokens: 45 } });
    if (results.length === 1) {
      assert.match(results[0].content, /<habilidade nome="formatar-email">\nNova versão\.\n<\/habilidade>/);
      return Response.json({ choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [call("b")] } }], usage: { prompt_tokens: 60, completion_tokens: 5, total_tokens: 65 } });
    }
    assert.match(results[1].content, /ja_carregado/);
    assert.doesNotMatch(results[1].content, /Nova versão/);
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: "Olá, segue o e-mail." } }], usage: { prompt_tokens: 70, completion_tokens: 10, total_tokens: 80 } });
  });
  try {
    const f = await flowWith(skill.id);
    const run = await startRun(f.id, "Escreva um e-mail para o cliente.");
    assert.equal(run.status, "completed");
    assert.equal(run.output, "Olá, segue o e-mail.");
    assert.equal(rounds, 3);
    const loads = run.trace.filter((trace) => trace.skill);
    assert.deepEqual(loads.map((trace) => [trace.label, trace.status, !!trace.skill?.repeated]), [["Habilidade: formatar-email", "completed", false], ["Habilidade: formatar-email", "completed", true]]);
    const step = run.trace.find((trace) => trace.type === "step" && trace.skills)!;
    assert.deepEqual(step.skills!.available.map((item) => item.name), ["formatar-email"]);
    assert.equal(step.skills!.loaded.length, 1);
    assert.ok(step.skills!.catalogTokens > 0 && step.skills!.loaded[0].tokens > 0);
    assert.equal(step.usage?.total, 190);
    // Em uso: a exclusão é recusada e diz onde; a exportação genérica não leva o vínculo da conta.
    await assert.rejects(() => deleteSkill(skill.id), /em uso em: “Com habilidade”/);
    assert.equal(portableGraph(f.graph).nodes[1].data.config.skills, undefined);
    // Habilidade removida por fora depois de salvar o fluxo: a execução é recusada antes de chamar o modelo.
    const { db, user } = currentTenant();
    await db.query("DELETE FROM skills WHERE user_id=$1 AND id=$2", [user.id, skill.id]);
    const before = rounds;
    await assert.rejects(() => buildRun(f.id, "Outra mensagem"), /foi excluída/);
    assert.equal(rounds, before);
    await flows.deleteFlow(f.id);
  } finally { setConfig("OPENROUTER_API_KEY", null); }
});

test("salvar fluxo com habilidade de outra conta ou inexistente é recusado", async () => {
  await assert.rejects(() => flowWith("11111111-1111-4111-8111-111111111111"), /Habilidade não encontrada nesta conta/);
  await assert.rejects(() => flowWith("não-é-id"), /lista de habilidades/);
});
