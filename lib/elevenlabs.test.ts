import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createTenantTestContext } from "../scripts/tenant-test-context";
const context = await createTenantTestContext();
const { setConfig } = await import("./store");
const el = await import("./elevenlabs");
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
tenantTest("fala, transcrição e ligação usam a chave e os identificadores de Conexões", async () => {
  setConfig("ELEVENLABS_API_KEY", "sk_teste");
  setConfig("ELEVENLABS_VOICE_ID", "voz1");
  setConfig("ELEVENLABS_AGENT_ID", "ag1");
  setConfig("ELEVENLABS_PHONE_NUMBER_ID", "ph1");
  const m = mockFetch((url) =>
    url.includes("/text-to-speech/")
      ? new Response(new Uint8Array([1, 2, 3]), { status: 200 })
      : url.includes("/speech-to-text")
        ? { text: " olá mundo " }
        : { success: true, conversation_id: "conv1", callSid: "CA1" },
  );
  try {
    const audio = await el.falar("Olá");
    assert.equal(audio.byteLength, 3);
    assert.match(m.calls[0].url, /\/text-to-speech\/voz1\?output_format=mp3_44100_128$/);
    assert.equal((m.calls[0].init?.headers as Record<string, string>)["xi-api-key"], "sk_teste");
    assert.equal(await el.transcrever(new Blob([new Uint8Array(10)], { type: "audio/webm" })), "olá mundo");
    assert.ok(m.calls[1].init?.body instanceof FormData);
    const r = await el.ligar("(11) 99999-0000", "Confirmar reunião");
    assert.deepEqual(r, { ok: true, conversationId: "conv1", callSid: "CA1" });
    const corpo = JSON.parse(String(m.calls[2].init?.body));
    assert.equal(corpo.agent_id, "ag1");
    assert.equal(corpo.to_number, "+11999990000");
    assert.equal(corpo.conversation_initiation_client_data.dynamic_variables.contexto, "Confirmar reunião");
    await assert.rejects(() => el.ligar("123", ""), /DDI e DDD/);
    await assert.rejects(() => el.transcrever(new Blob([])), /Nenhum áudio/);
  } finally {
    m.restore();
  }
  setConfig("ELEVENLABS_API_KEY", null);
  await assert.rejects(() => el.falar("x"), /Conecte a ElevenLabs/);
});
test("assinatura do aviso pós-ligação e leitura da transcrição", () => {
  const corpo = JSON.stringify({ type: "post_call_transcription", data: { conversation_id: "c1" } });
  const t = Math.floor(Date.now() / 1000);
  const v0 = createHmac("sha256", "segredo").update(`${t}.${corpo}`).digest("hex");
  assert.equal(el.assinaturaConfere(corpo, `t=${t},v0=${v0}`, "segredo"), true);
  assert.equal(el.assinaturaConfere(corpo, `t=${t},v0=${v0}`, "outro"), false);
  assert.equal(el.assinaturaConfere(corpo, `t=${t - 3600},v0=${v0}`, "segredo"), false);
  assert.equal(el.assinaturaConfere(corpo, null, "segredo"), false);
  const lida = el.interpretarPosLigacao({
    type: "post_call_transcription",
    data: {
      conversation_id: "c1",
      transcript: [
        { role: "agent", message: "Olá, aqui é da Acme." },
        { role: "user", message: "Oi, pode falar." },
      ],
      analysis: { transcript_summary: "Cliente aceitou a reunião." },
      metadata: { phone_call: { external_number: "+5511999990000" } },
      conversation_initiation_client_data: { dynamic_variables: { contexto: "Confirmar reunião" } },
    },
  })!;
  assert.equal(lida.telefone, "+5511999990000");
  assert.match(lida.transcricao, /^Agente: Olá.*\nPessoa: Oi/);
  assert.equal(lida.resumo, "Cliente aceitou a reunião.");
  assert.equal(el.interpretarPosLigacao({ type: "outro" }), null);
});
tenantTest("transcrição preserva formato do navegador e pedidos de voz aceitam cancelamento", async () => {
  setConfig("ELEVENLABS_API_KEY", "fixture");
  const controller = new AbortController();
  const m = mockFetch(() => ({ text: "Olá" }));
  try {
    await el.transcrever(new Blob(["audio"], { type: "audio/mp4" }), controller.signal);
    const form = m.calls[0].init?.body as FormData;
    assert.equal((form.get("file") as File).name, "audio.m4a");
    controller.abort(); assert.equal(m.calls[0].init?.signal?.aborted, true);
  } finally { m.restore(); setConfig("ELEVENLABS_API_KEY", null); }
});
