import test from "node:test";
import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import { frontmatterFields, parseSkillMarkdown, parseSkillUpload } from "./skill-package";
import { skillIds } from "./skill-settings";

const skillMd = (name = "formatar-email", description = "Formata e-mails. Use quando pedirem um e-mail.") =>
  `---\nname: ${name}\ndescription: ${description}\n---\n# Formatação\nUse parágrafos curtos.`;

test("SKILL.md isolado: lê name, description e instruções", () => {
  const skill = parseSkillUpload("SKILL.md", strToU8(skillMd()));
  assert.equal(skill.name, "formatar-email");
  assert.equal(skill.description, "Formata e-mails. Use quando pedirem um e-mail.");
  assert.equal(skill.body, "# Formatação\nUse parágrafos curtos.");
  assert.deepEqual(skill.files, []);
});

test("cabeçalho YAML aceita aspas, blocos | e >, comentários e ignora mapas aninhados", () => {
  const fields = frontmatterFields([
    'name: "triagem"',
    "description: >",
    "  Use quando a pessoa",
    "  pedir triagem.",
    "license: 'MIT' # licença",
    "metadata:",
    "  author: exemplo",
    "notes: |",
    "  linha 1",
    "  linha 2",
  ].join("\n"));
  assert.equal(fields.name, "triagem");
  assert.equal(fields.description, "Use quando a pessoa pedir triagem.");
  assert.equal(fields.license, "MIT");
  assert.equal(fields.notes, "linha 1\nlinha 2");
  assert.equal(fields.metadata, undefined);
});

test("SKILL.md inválido tem orientação: sem cabeçalho, sem description, name fora do padrão", () => {
  assert.throws(() => parseSkillMarkdown("# Sem cabeçalho"), /cabeçalho YAML/);
  assert.throws(() => parseSkillMarkdown("---\nname: x\n---\ncorpo"), /description/);
  assert.throws(() => parseSkillMarkdown(skillMd("Formatar_Email")), /letras minúsculas/);
  assert.throws(() => parseSkillMarkdown(skillMd("a--b")), /letras minúsculas/);
  assert.throws(() => parseSkillMarkdown(skillMd("a".repeat(65))), /64/);
  assert.throws(() => parseSkillMarkdown(skillMd("ok", "x".repeat(1025))), /1024/);
  assert.throws(() => parseSkillMarkdown("---\nname: ok\ndescription: d\n---\n"), /instruções/);
  assert.throws(() => parseSkillUpload("leia-me.md", strToU8(skillMd())), /SKILL\.md/);
});

test(".zip: pasta com o nome da habilidade, arquivos de texto disponíveis e binários listados", () => {
  const zip = zipSync({
    "formatar-email/SKILL.md": strToU8(skillMd()),
    "formatar-email/references/tom.md": strToU8("Tom cordial."),
    "formatar-email/assets/logo.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 0xff]),
    "__MACOSX/formatar-email/._SKILL.md": strToU8("lixo"),
    "formatar-email/.DS_Store": new Uint8Array([0, 0, 0]),
  });
  const skill = parseSkillUpload("formatar-email.zip", zip);
  assert.equal(skill.name, "formatar-email");
  assert.deepEqual(skill.files, [{ path: "references/tom.md", content: "Tom cordial." }]);
  assert.deepEqual(skill.skipped, ["assets/logo.png (não é texto)"]);
});

test(".zip: pasta diferente do name, SKILL.md na raiz, ausente ou repetido é recusado", () => {
  assert.throws(() => parseSkillUpload("x.zip", zipSync({ "outra/SKILL.md": strToU8(skillMd()) })), /mesmo nome/);
  assert.throws(() => parseSkillUpload("x.zip", zipSync({ "SKILL.md": strToU8(skillMd()) })), /dentro de uma pasta/);
  assert.throws(() => parseSkillUpload("x.zip", zipSync({ "formatar-email/README.md": strToU8("oi") })), /incluir uma pasta com o SKILL\.md/);
  assert.throws(() => parseSkillUpload("x.zip", zipSync({ "a/SKILL.md": strToU8(skillMd("a")), "b/SKILL.md": strToU8(skillMd("b")) })), /única habilidade/);
  assert.throws(() => parseSkillUpload("x.zip", strToU8("não é zip")), /SKILL\.md ou um pacote \.zip/);
  assert.throws(() => parseSkillUpload("x.zip", zipSync({ "formatar-email/SKILL.md": strToU8(skillMd()), "formatar-email/../fora.md": strToU8("x") })), /caminho de arquivo inválido/);
});

test("config.skills aceita até 20 ids UUID distintos", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(skillIds({ skills: ` ${id} ` }), [id]);
  assert.deepEqual(skillIds({}), []);
  assert.throws(() => skillIds({ skills: `${id},${id}` }), /inválida/);
  assert.throws(() => skillIds({ skills: "nao-e-uuid" }), /inválida/);
});
