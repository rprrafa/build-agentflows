import test from "node:test";
import assert from "node:assert/strict";
import { agentSkills, MAX_SKILL_REPEATS, skillCallLimit, skillLabel, SKILL_TOOL } from "./skill-agent";
import type { StoredSkill } from "./skill-service";
import { SKILL_READ_CHARS } from "./skill-settings";

const skill = (name: string, files: StoredSkill["files"] = []): StoredSkill => ({
  id: "11111111-1111-4111-8111-11111111111" + name.length, name, description: `Descrição de ${name}.`, body: `Instruções de ${name}.`,
  files, skipped: [], createdAt: "", updatedAt: "",
});

test("sem habilidades não há catálogo nem ferramenta", () => {
  const skills = agentSkills([]);
  assert.equal(skills.context, "");
  assert.deepEqual(skills.tools, []);
  assert.equal(skills.summary(), undefined);
});

test("catálogo leva só nome e descrição; o SKILL.md chega quando o modelo carrega a habilidade", async () => {
  const skills = agentSkills([skill("triagem", [{ path: "references/guia.md", content: "Guia." }])]);
  assert.match(skills.context, /<habilidades_disponiveis>\n- triagem: Descrição de triagem\.\n<\/habilidades_disponiveis>/);
  assert.doesNotMatch(skills.context, /Instruções de triagem/);
  assert.equal(skills.tools[0].name, SKILL_TOOL);
  assert.deepEqual((skills.tools[0].schema as { properties: { nome: { enum: string[] } } }).properties.nome.enum, ["triagem"]);
  const output = await skills.tools[0].call({ nome: "triagem" });
  assert.match(output, /<habilidade nome="triagem">\nInstruções de triagem\.\n<\/habilidade>/);
  assert.match(output, /references\/guia\.md/);
  assert.deepEqual(skills.summary()!.loaded, [{ name: "triagem", tokens: Math.ceil(output.length / 4) }]);
  assert.ok(skills.summary()!.catalogTokens > 0);
  assert.equal(skillLabel({ nome: "triagem", arquivo: "./references/guia.md" }), "Habilidade: triagem · references/guia.md");
});

test("repetição devolve aviso curto, sem reenviar o conteúdo, e é recusada quando vira ciclo", () => {
  const skills = agentSkills([skill("triagem")]);
  skills.load({ nome: "triagem" });
  for (let i = 0; i < MAX_SKILL_REPEATS; i++) {
    const again = skills.load({ nome: "triagem", arquivo: "SKILL.md" });
    assert.match(again.output, /ja_carregado/);
    assert.equal(again.use.repeated, true);
  }
  assert.throws(() => skills.load({ nome: "triagem" }), /Pare de chamar/);
  assert.equal(skills.summary()!.loaded.length, 1);
});

test("nome inventado, arquivo inexistente e argumentos inválidos são recusados com a lista correta", () => {
  const skills = agentSkills([skill("triagem"), skill("resumo")]);
  assert.throws(() => skills.load({ nome: "inventada" }), /não existe neste agente\. Disponíveis: triagem, resumo/);
  assert.throws(() => skills.load({ nome: "triagem", arquivo: "../segredo" }), /não existe na habilidade triagem\. Ela só tem o SKILL\.md/);
  assert.throws(() => skills.load("triagem"), /Informe o nome/);
  assert.throws(() => skills.load({ nome: "triagem", inicio: -1 }), /inteiro/);
});

test("arquivo longo é lido em partes com a posição seguinte", () => {
  const content = "a".repeat(SKILL_READ_CHARS + 10);
  const skills = agentSkills([skill("dados", [{ path: "ref.md", content }])]);
  const first = skills.load({ nome: "dados", arquivo: "ref.md" });
  assert.match(first.output, new RegExp(`inicio=${SKILL_READ_CHARS}`));
  const second = skills.load({ nome: "dados", arquivo: "ref.md", inicio: SKILL_READ_CHARS });
  assert.doesNotMatch(second.output, /continua/);
  assert.throws(() => skills.load({ nome: "dados", arquivo: "ref.md", inicio: content.length }), /não há conteúdo/);
});

test("limite de chamadas por etapa interrompe o ciclo de carregamentos", () => {
  const files = Array.from({ length: 30 }, (_, i) => ({ path: `f${i}.md`, content: "x" }));
  const skills = agentSkills([skill("muitos", files)]);
  const limit = skillCallLimit(1);
  for (let i = 0; i < limit; i++) skills.load({ nome: "muitos", arquivo: `f${i}.md` });
  assert.throws(() => skills.load({ nome: "muitos", arquivo: "f29.md" }), /Limite de 10 carregamentos/);
});
