import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "agentflows-whatsapp-"));
process.env.DATA_DIR = dir;
const { setConfig } = await import("./store");
const { salvarCampos, chaveWebhook } = await import("./conexoes");
const wa = await import("./whatsapp");
const store = await import("./flow-store");
const { block } = await import("./flow-types");
const { processarWhatsApp } = await import("./channel-flows");
const webhook = await import("../app/webhook/whatsapp/route");
const { chatGPT } = await import("./chatgpt");
chatGPT().account = async () => ({
  account: { type: "chatgpt", email: "t@example.com", planType: "plus" },
  login: null,
  error: null,
});
test.after(() => rmSync(dir, { recursive: true, force: true }));
function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const original = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = handler(String(url), init);
    return r instanceof Response ? r : Response.json(r ?? {});
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}
test("interpreta avisos dos três provedores e ignora grupos e mensagens próprias", () => {
  assert.deepEqual(
    wa.interpretarRecebido({ type: "ReceivedCallback", phone: "5511999990000", senderName: "Ana", text: { message: "Oi" } }),
    { de: "5511999990000", texto: "Oi", nome: "Ana", provedor: "zapi" },
  );
  assert.equal(wa.interpretarRecebido({ type: "ReceivedCallback", phone: "55", fromMe: true, text: { message: "x" } }), null);
  assert.equal(wa.interpretarRecebido({ type: "ConnectedCallback", phone: "55" }), null);
  assert.deepEqual(
    wa.interpretarRecebido({
      entry: [{ changes: [{ value: { contacts: [{ profile: { name: "Bia" } }], messages: [{ from: "5521988887777", type: "text", text: { body: "Olá" } }] } }] }],
    }),
    { de: "5521988887777", texto: "Olá", nome: "Bia", provedor: "meta" },
  );
  assert.equal(wa.interpretarRecebido({ entry: [{ changes: [{ value: { messages: [{ from: "55", type: "image" }] } }] }] }), null);
  assert.deepEqual(
    wa.interpretarRecebido({ event: { Info: { Sender: "5531977776666@s.whatsapp.net", PushName: "Caio" }, Message: { ExtendedTextMessage: { Text: "Bom dia" } } } }),
    { de: "5531977776666", texto: "Bom dia", nome: "Caio", provedor: "zapperhub" },
  );
  assert.equal(wa.interpretarRecebido({ event: { Info: { Sender: "1@g.us", IsGroup: true }, Message: { Conversation: "x" } } }), null);
  assert.equal(wa.interpretarRecebido("nada"), null);
});
test("envia pelo provedor escolhido com as credenciais salvas", async () => {
  salvarCampos({ WHATSAPP_PROVEDOR: "zapi", ZAPI_INSTANCE_ID: "inst", ZAPI_TOKEN: "tok", ZAPI_CLIENT_TOKEN: "cli" }, { provedor: "zapi", versao: "2026-09-20" });
  let m = mockFetch(() => ({ messageId: "1" }));
  try {
    await wa.enviarMensagem("+55 (11) 99999-0000", "Olá!");
    assert.match(m.calls[0].url, /api\.z-api\.io\/instances\/inst\/token\/tok\/send-text$/);
    assert.equal((m.calls[0].init?.headers as Record<string, string>)["Client-Token"], "cli");
    assert.deepEqual(JSON.parse(String(m.calls[0].init?.body)), { phone: "5511999990000", message: "Olá!" });
    await assert.rejects(() => wa.enviarMensagem("123", "x"), /DDI e DDD/);
  } finally {
    m.restore();
  }
  salvarCampos({ WHATSAPP_PROVEDOR: "meta", WHATSAPP_TOKEN: "t-meta", WHATSAPP_PHONE_NUMBER_ID: "999" });
  m = mockFetch(() => ({ messages: [{ id: "x" }] }));
  try {
    await wa.enviarMensagem("5511999990000", "Oi");
    assert.match(m.calls[0].url, /graph\.facebook\.com\/v21\.0\/999\/messages$/);
    assert.equal(JSON.parse(String(m.calls[0].init?.body)).to, "5511999990000");
  } finally {
    m.restore();
  }
  salvarCampos({ WHATSAPP_PROVEDOR: "zapperhub", ZAPPERHUB_KEY: "k-1", ZAPPERHUB_URL: "https://api.zapperapi.com/" }, { provedor: "zapperhub", versao: "2026-09-20" });
  m = mockFetch(() => ({ success: true }));
  try {
    await wa.enviarMensagem("5511999990000", "Oi");
    assert.equal(m.calls[0].url, "https://api.zapperapi.com/chat/send/text");
    assert.deepEqual(JSON.parse(String(m.calls[0].init?.body)), { Phone: "5511999990000", Body: "Oi" });
    assert.equal((m.calls[0].init?.headers as Record<string, string>)["X-Api-Key"], "k-1");
    const avisos = await wa.configurarAvisos("https://app.exemplo.com/");
    assert.match(avisos || "", /^https:\/\/app\.exemplo\.com\/webhook\/whatsapp\?chave=/);
    assert.equal(m.calls[1].url, "https://api.zapperapi.com/webhook");
  } finally {
    m.restore();
  }
  m = mockFetch(() => new Response("unauthorized", { status: 401 }));
  try {
    await assert.rejects(() => wa.enviarMensagem("5511999990000", "Oi"), /recusou as credenciais/);
  } finally {
    m.restore();
  }
});
test("aviso recebido executa o fluxo publicado e responde pelo mesmo número", async () => {
  const f = store.createFlow("Atendimento");
  const g = { nodes: [block("start", "inicio", 0, 0), block("end", "fim", 0, 0)], edges: [{ id: "1", source: "inicio", target: "fim" }] };
  g.nodes[1].data.config.text = "Recebemos: {{input}}";
  store.saveFlow(f.id, { name: f.name, description: "", graph: g });
  store.publishFlow(f.id);
  salvarCampos({ WHATSAPP_PROVEDOR: "zapi", ZAPI_INSTANCE_ID: "inst", ZAPI_TOKEN: "tok", ZAPI_CLIENT_TOKEN: "cli" }, { provedor: "zapi", versao: "2026-09-20" });
  setConfig("WHATSAPP_FLOW_ID", f.id);
  const m = mockFetch(() => ({ messageId: "1" }));
  try {
    const chave = chaveWebhook();
    const recusado = await webhook.POST(new Request("http://x/webhook/whatsapp?chave=errada", { method: "POST", body: "{}" }));
    assert.equal(recusado.status, 401);
    const verificacao = await webhook.GET(new Request(`http://x/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=${chave}&hub.challenge=abc`));
    assert.equal(await verificacao.text(), "abc");
    const resposta = await processarWhatsApp({ de: "5511999990000", texto: "Quero um orçamento", provedor: "zapi" });
    assert.equal(resposta, "Recebemos: Quero um orçamento");
    assert.deepEqual(JSON.parse(String(m.calls[0].init?.body)), { phone: "5511999990000", message: "Recebemos: Quero um orçamento" });
    const ok = await webhook.POST(new Request(`http://x/webhook/whatsapp?chave=${chave}`, { method: "POST", body: JSON.stringify({ type: "ReceivedCallback", phone: "55", fromMe: true }) }));
    assert.equal(ok.status, 200);
  } finally {
    m.restore();
    setConfig("WHATSAPP_FLOW_ID", null);
  }
});

test("conexão não oficial antiga não envia nem processa sem aceite", async () => {
  setConfig("WHATSAPP_PROVEDOR", "zapi");
  setConfig("WHATSAPP_ACEITE", null);
  await assert.rejects(() => wa.enviarMensagem("5511999990000", "Oi"), /Conecte o WhatsApp/);
  assert.equal(await processarWhatsApp({ de: "5511999990000", texto: "Oi", nome: "Ana", provedor: "zapi" }), null);
});
