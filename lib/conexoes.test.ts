import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "agentflows-conexoes-"));
process.env.DATA_DIR = dir;
const { getConfig, setConfig } = await import("./store");
const c = await import("./conexoes");
test.after(() => rmSync(dir, { recursive: true, force: true }));
test("salvar campos aceita só chaves conhecidas e preserva segredos mascarados", () => {
  c.salvarCampos({ WHATSAPP_PROVEDOR: "zapi", ZAPI_TOKEN: "segredo-123456" }, { provedor: "zapi", versao: "2026-09-20" });
  assert.equal(getConfig("ZAPI_TOKEN"), "segredo-123456");
  c.salvarCampos({ ZAPI_TOKEN: "segr••••3456" });
  assert.equal(getConfig("ZAPI_TOKEN"), "segredo-123456");
  c.salvarCampos({ ZAPI_TOKEN: null });
  assert.equal(getConfig("ZAPI_TOKEN"), undefined);
  assert.throws(() => c.salvarCampos({ CHAVE_MESTRA: "x" }), /desconhecido/);
  assert.throws(() => c.salvarCampos({ ZAPI_TOKEN: 12 }), /inválido/);
  const status = c.statusCampos(c.WHATSAPP_CAMPOS);
  assert.equal(status.find((s) => s.chave === "WHATSAPP_PROVEDOR")?.valor, "zapi");
  assert.equal(status.find((s) => s.chave === "ZAPI_TOKEN")?.definido, false);
});
test("servidores MCP: adicionar, listar com a conexão antiga, remover", async () => {
  setConfig("FERRAMENTAS_URL", "https://antigo.exemplo.com/mcp");
  const novo = c.adicionarServidorMCP("CRM", "https://crm.exemplo.com/mcp", "abc");
  assert.match(novo.prefixo, /^MCP_[0-9A-F]{6}$/);
  const lista = c.servidoresMCP();
  assert.deepEqual(
    lista.map((s) => s.nome),
    ["Ferramentas", "CRM"],
  );
  assert.equal(getConfig(`${novo.prefixo}_CODIGO`), "abc");
  assert.equal((await c.conexaoMCP(novo.prefixo))?.url, "https://crm.exemplo.com/mcp");
  assert.throws(() => c.adicionarServidorMCP("", "https://x"), /nome/);
  assert.throws(() => c.adicionarServidorMCP("X", "ftp://x"), /endereço/);
  c.removerServidorMCP(novo.prefixo);
  assert.equal(c.servidoresMCP().length, 1);
  assert.equal(getConfig(`${novo.prefixo}_URL`), undefined);
  assert.throws(() => c.servidorMCP(novo.prefixo), /não encontrado/);
});
test("provedor do WhatsApp e estado das conexões", async () => {
  setConfig("WHATSAPP_PROVEDOR", null);
  setConfig("ZAPI_INSTANCE_ID", null);
  assert.equal(c.provedorWhatsApp(), null);
  c.salvarCampos({ WHATSAPP_PROVEDOR: "meta", WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "1" });
  assert.equal(c.provedorWhatsApp(), "meta");
  assert.equal(c.whatsappConfigurado(), true);
  c.salvarCampos({ ELEVENLABS_API_KEY: "sk_1234567890" });
  const s = await c.statusConexoes("https://app.exemplo.com");
  assert.equal(s.whatsapp.configurado, true);
  assert.match(s.whatsapp.aviso, /^https:\/\/app\.exemplo\.com\/webhook\/whatsapp\?chave=[a-f0-9]{48}$/);
  assert.equal(s.elevenlabs.configurado, true);
  assert.equal(s.elevenlabs.ligacao, false);
  assert.equal(s.openrouter.conectado, false);
  assert.equal(s.elevenlabs.campos[0].mascarado, "sk_1••••7890");
});

test("aceite não oficial é específico por provedor, versionado e obrigatório antes de gravar", () => {
  setConfig("WHATSAPP_ACEITE", null);
  setConfig("WHATSAPP_PROVEDOR", "meta");
  const fields = { WHATSAPP_PROVEDOR: "zapi", ZAPI_TOKEN: "novo" };
  assert.throws(() => c.salvarCampos(fields), /aceite os termos/);
  assert.equal(getConfig("WHATSAPP_PROVEDOR"), "meta");
  assert.throws(() => c.salvarCampos(fields, { provedor: "zapperhub", versao: "2026-09-20" }), /aceite/);
  assert.throws(() => c.salvarCampos(fields, { provedor: "zapi", versao: "antiga" }), /aceite/);
  c.salvarCampos(fields, { provedor: "zapi", versao: "2026-09-20" });
  assert.equal(c.aceiteWhatsAppAtual()?.provedor, "zapi");
  assert.ok(c.aceiteWhatsAppAtual()?.data);
  assert.throws(() => c.salvarCampos({ WHATSAPP_PROVEDOR: "zapperhub" }), /aceite/);
  c.salvarCampos({ WHATSAPP_PROVEDOR: "meta" });
  assert.throws(() => c.salvarCampos({ TOOL_TAVILY_KEY: "should-not-save", INVALID: "x" }), /desconhecido/);
  assert.equal(getConfig("TOOL_TAVILY_KEY"), undefined);
});
test("editar servidor preserva vínculo dos agentes e troca de endereço invalida a autorização", async () => {
  const server = c.adicionarServidorMCP("Antes", "https://a.example/mcp", "token-a");
  c.atualizarServidorMCP(server.prefixo, "Depois", "https://a.example/mcp");
  assert.equal(c.servidorMCP(server.prefixo).nome, "Depois");
  assert.equal(getConfig(`${server.prefixo}_CODIGO`), "token-a");
  c.atualizarServidorMCP(server.prefixo, "Depois", "https://b.example/mcp", "token-b");
  assert.equal(c.servidorMCP(server.prefixo).url, "https://b.example/mcp");
  assert.equal(getConfig(`${server.prefixo}_CODIGO`), "token-b");
  c.removerServidorMCP(server.prefixo);
});
