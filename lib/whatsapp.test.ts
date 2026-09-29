import test from "node:test";
import assert from "node:assert/strict";
import { createTenantTestContext } from "../scripts/tenant-test-context";
const context = await createTenantTestContext();
const { salvarCampos } = await import("./conexoes");
const wa = await import("./whatsapp");
const tenantTest = (name: string, action: () => Promise<void>) => test(name, () => context.asTenant(action));
test.after(context.close);
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
    wa.interpretarRecebidos({ type: "ReceivedCallback", messageId: "z1", instanceId: "inst", phone: "5511999990000", senderName: "Ana", text: { message: "Oi" } }),
    [{ id: "z1", conta: "inst", de: "5511999990000", texto: "Oi", nome: "Ana", provedor: "zapi" }],
  );
  assert.deepEqual(wa.interpretarRecebidos({ type: "ReceivedCallback", phone: "55", fromMe: true, text: { message: "x" } }), []);
  assert.deepEqual(wa.interpretarRecebidos({ type: "ConnectedCallback", phone: "55" }), []);
  assert.deepEqual(
    wa.interpretarRecebidos({
      entry: [{ changes: [{ value: { metadata: { phone_number_id: "meta1" }, contacts: [{ profile: { name: "Bia" } }], messages: [{ id: "m1", from: "5521988887777", type: "text", text: { body: "Olá" } }] } }] }],
    }),
    [{ id: "m1", conta: "meta1", de: "5521988887777", texto: "Olá", provedor: "meta" }],
  );
  assert.deepEqual(wa.interpretarRecebidos({ entry: [{ changes: [{ value: { messages: [{ from: "55", type: "image" }] } }] }] }), []);
  assert.deepEqual(
    wa.interpretarRecebidos({ event: { Info: { ID: "w1", Sender: "5531977776666@s.whatsapp.net", PushName: "Caio" }, Message: { ExtendedTextMessage: { Text: "Bom dia" } } } }),
    [{ id: "w1", de: "5531977776666", texto: "Bom dia", nome: "Caio", provedor: "zapperhub" }],
  );
  assert.deepEqual(wa.interpretarRecebidos({ event: { Info: { Sender: "1@g.us", IsGroup: true }, Message: { Conversation: "x" } } }), []);
  assert.deepEqual(wa.interpretarRecebidos("nada"), []);
});
tenantTest("envia pelo provedor escolhido com as credenciais salvas", async () => {
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
