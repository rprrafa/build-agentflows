import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "agentflows-elevenlabs-"));
process.env.DATA_DIR = dir;
const { setConfig } = await import("./store");
const el = await import("./elevenlabs");
const store = await import("./flow-store");
const { block } = await import("./flow-types");
const { processarLigacao } = await import("./channel-flows");
const webhook = await import("../app/webhook/elevenlabs/route");
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
test("fala, transcrição e ligação usam a chave e os identificadores de Conexões", async () => {
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
test("fim de ligação executa o fluxo escolhido com a transcrição", async () => {
  const f = store.createFlow("Pós-ligação");
  const g = { nodes: [block("start", "inicio", 0, 0), block("end", "fim", 0, 0)], edges: [{ id: "1", source: "inicio", target: "fim" }] };
  g.nodes[1].data.config.text = "Registrado: {{input}}";
  store.saveFlow(f.id, { name: f.name, description: "", graph: g });
  store.publishFlow(f.id);
  setConfig("ELEVENLABS_FLOW_ID", f.id);
  setConfig("ELEVENLABS_WEBHOOK_SECRET", "segredo");
  const r = await processarLigacao({ conversationId: "c1", transcricao: "Agente: Olá\nPessoa: Oi", resumo: "Curta", telefone: "+55", variaveis: {} });
  assert.equal(r?.status, "completed");
  assert.match(r?.output || "", /Registrado: Telefone: \+55\nResumo: Curta\n\nTranscrição:\nAgente: Olá/);
  const corpo = JSON.stringify({ type: "post_call_transcription", data: { conversation_id: "c2", transcript: [] } });
  const semAssinatura = await webhook.POST(new Request("http://x/webhook/elevenlabs", { method: "POST", body: corpo }));
  assert.equal(semAssinatura.status, 401);
  const t = Math.floor(Date.now() / 1000);
  const v0 = createHmac("sha256", "segredo").update(`${t}.${corpo}`).digest("hex");
  const ok = await webhook.POST(new Request("http://x/webhook/elevenlabs", { method: "POST", body: corpo, headers: { "elevenlabs-signature": `t=${t},v0=${v0}` } }));
  assert.equal(ok.status, 200);
  setConfig("ELEVENLABS_FLOW_ID", null);
});

test("transcrição preserva formato do navegador e pedidos de voz aceitam cancelamento", async () => {
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
