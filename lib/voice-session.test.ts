import test from "node:test";
import assert from "node:assert/strict";
import { VoiceSession, VoiceActivity, speechChunks, type VoiceAudio, type VoiceDependencies, type VoiceEvents, type VoiceState } from "./voice-session";
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture(overrides: Partial<VoiceDependencies> = {}) {
  let events!: VoiceEvents, closed = 0, played = 0, listened = 0;
  const messages: string[] = [], states: VoiceState[] = [], synthesized: string[] = [];
  const audio: VoiceAudio = { listen: () => { listened++; }, pause: () => {}, close: () => { closed++; }, play: async () => { played++; } };
  const voice = new VoiceSession({
    openAudio: async (e) => { events = e; return audio; },
    transcribe: async () => "Qual a previsão?",
    respond: async (text) => { messages.push(text); return { status: "completed", output: "A previsão é positiva." }; },
    synthesize: async (text) => { synthesized.push(text); return new ArrayBuffer(2); },
    onChange: (state) => states.push(state), ...overrides,
  });
  return { voice, audio, messages, states, synthesized, events: () => events, counts: () => ({ closed, played, listened }) };
}
test("pausa envia uma vez, fala a resposta e volta a ouvir para a próxima pergunta", async () => {
  const f = fixture(); await f.voice.start();
  f.events().activity(.2, true); f.events().audio(new Blob(["audio"])); f.events().audio(new Blob(["duplicate"]));
  await tick();
  assert.deepEqual(f.messages, ["Qual a previsão?"]); assert.equal(f.counts().played, 1); assert.equal(f.voice.state.phase, "listening");
  f.events().audio(new Blob(["second"])); await tick(); assert.equal(f.messages.length, 2);
  f.voice.stop(); assert.equal(f.counts().closed, 1);
});
test("silêncio transcrito não executa o fluxo; silenciar descarta fala até reativar", async () => {
  const f = fixture({ transcribe: async () => "" }); await f.voice.start();
  f.events().audio(new Blob(["silence"])); await tick(); assert.equal(f.messages.length, 0); assert.equal(f.voice.state.phase, "listening");
  f.voice.setMuted(true); f.events().audio(new Blob(["muted"])); await tick(); assert.equal(f.voice.state.phase, "muted"); assert.equal(f.counts().played, 0);
  f.voice.setMuted(false); assert.equal(f.voice.state.phase, "listening"); f.voice.stop();
});
test("encerrar durante transcrição aborta o pedido e ignora uma resposta atrasada", async () => {
  const pending = deferred<string>(); let signal!: AbortSignal;
  const f = fixture({ transcribe: async (_blob, s) => { signal = s; return pending.promise; } }); await f.voice.start();
  f.events().audio(new Blob(["audio"])); f.voice.stop(); assert.equal(signal.aborted, true);
  pending.resolve("não enviar"); await tick(); assert.deepEqual(f.messages, []); assert.equal(f.voice.state.phase, "idle");
});
test("encerrar durante o fluxo não fala nem inicia outro turno quando a execução termina", async () => {
  const response = deferred<{ status: string; output: string }>();
  const f = fixture({ respond: async () => response.promise }); await f.voice.start();
  const turn = f.voice.sendText("Pergunta digitada"); await tick(); assert.equal(f.voice.state.phase, "thinking");
  f.voice.stop(); response.resolve({ status: "completed", output: "Resposta atrasada" }); await turn;
  assert.equal(f.counts().played, 0); assert.equal(f.voice.state.phase, "idle");
});
test("interrupção por voz para o áudio e não repete o texto já processado", async () => {
  const f = fixture(); let cancelled = false;
  f.audio.play = async (_bytes, signal) => new Promise<void>((resolve) => signal.addEventListener("abort", () => { cancelled = true; resolve(); }, { once: true }));
  await f.voice.start(); const turn = f.voice.sendText("Primeira"); await tick(); assert.equal(f.voice.state.phase, "speaking");
  f.events().activity(.3, true); await turn;
  assert.equal(cancelled, true); assert.equal(f.voice.state.phase, "hearing"); assert.deepEqual(f.messages, ["Primeira"]);
  f.voice.stop();
});
test("aprovação humana pausa a escuta; falha do provedor libera o microfone e permite reiniciar", async () => {
  const f = fixture({ respond: async () => ({ status: "waiting", output: "Aprovar" }) }); await f.voice.start();
  await f.voice.sendText("Faça"); assert.equal(f.voice.state.phase, "waiting"); assert.equal(f.counts().played, 0); f.voice.stop();
  const error = fixture({ synthesize: async () => { throw new Error("Sem créditos"); } }); await error.voice.start(); await error.voice.sendText("Olá");
  assert.equal(error.voice.state.phase, "error"); assert.match(error.voice.state.error, /Sem créditos/); assert.equal(error.counts().closed, 1);
  await error.voice.start(); assert.equal(error.voice.state.phase, "listening"); error.voice.stop();
});
test("permissão concedida após encerrar libera a captura sem começar a ouvir", async () => {
  const pending = deferred<VoiceAudio>(); let signal!: AbortSignal;
  const f = fixture({ openAudio: async (_events, s) => { signal = s; return pending.promise; } });
  const opening = f.voice.start(); f.voice.stop(); assert.equal(signal.aborted, true); pending.resolve(f.audio); await opening;
  assert.equal(f.counts().closed, 1); assert.equal(f.counts().listened, 0); assert.equal(f.voice.state.phase, "idle");
});
test("detecção ignora ruído isolado e pausas curtas; respostas longas não são cortadas", () => {
  const vad = new VoiceActivity();
  assert.equal(vad.sample(.2, 50), null); assert.equal(vad.sample(0, 100), null);
  assert.equal(vad.sample(.1, 300), null); assert.equal(vad.sample(.1, 500), "start");
  assert.equal(vad.sample(0, 900), null); assert.equal(vad.sample(.1, 1000), null); assert.equal(vad.sample(0, 2001), "end");
  const text = "Uma resposta em português que precisa ser ouvida por completo. ".repeat(100).trim();
  const chunks = speechChunks(text); assert.ok(chunks.length > 2); assert.ok(chunks.every((s) => s.length <= 1800)); assert.equal(chunks.join(" "), text);
});

test("eventos de uma captura encerrada não afetam a nova conversa", async () => {
  const f = fixture(); await f.voice.start(); const stale = f.events(); f.voice.stop(); await f.voice.start();
  stale.audio(new Blob(["velho"])); stale.activity(.5, true); stale.error(new Error("Erro atrasado")); await tick();
  assert.equal(f.voice.state.phase, "listening"); assert.equal(f.messages.length, 0); f.voice.stop();
});
