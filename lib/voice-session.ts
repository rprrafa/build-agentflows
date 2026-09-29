// Ciclo da conversa independente do navegador, para validar concorrência e encerramento.
export type VoicePhase = "idle" | "connecting" | "listening" | "hearing" | "transcribing" | "thinking" | "speaking" | "muted" | "waiting" | "error";
export type VoiceState = { phase: VoicePhase; muted: boolean; level: number; error: string; transcript: string };
export const INITIAL_VOICE: VoiceState = { phase: "idle", muted: false, level: 0, error: "", transcript: "" };
export type VoiceEvents = { audio: (blob: Blob) => void; activity: (level: number, started: boolean) => void; error: (error: Error) => void };
export type VoiceAudio = { listen: (interruptible?: boolean) => void; pause: () => void; play: (bytes: ArrayBuffer, signal: AbortSignal) => Promise<void>; close: () => void };
export type VoiceReply = { status: string; output: string; error?: string };
export type VoiceDependencies = {
  openAudio: (events: VoiceEvents, signal: AbortSignal) => Promise<VoiceAudio>;
  transcribe: (blob: Blob, signal: AbortSignal) => Promise<string>;
  respond: (text: string) => Promise<VoiceReply | null>;
  synthesize: (text: string, signal: AbortSignal) => Promise<ArrayBuffer>;
  onChange: (state: VoiceState) => void;
};
export function speechChunks(text: string): string[] {
  let remaining = text.trim(); const chunks: string[] = [];
  while (remaining) {
    let end = Math.min(1800, remaining.length);
    if (end < remaining.length) {
      const sentence = Math.max(remaining.lastIndexOf(". ", end), remaining.lastIndexOf("! ", end), remaining.lastIndexOf("? ", end), remaining.lastIndexOf("\n", end));
      end = sentence > 500 ? sentence + 1 : Math.max(remaining.lastIndexOf(" ", end), 1);
      if (end < 500) end = 1800;
    }
    chunks.push(remaining.slice(0, end)); remaining = remaining.slice(end).trimStart();
  }
  return chunks;
}
export class VoiceSession {
  state: VoiceState = { ...INITIAL_VOICE };
  private active = false;
  private generation = 0;
  private turn = 0;
  private audio: VoiceAudio | null = null;
  private operation: AbortController | null = null;
  private deps: VoiceDependencies;
  constructor(deps: VoiceDependencies) { this.deps = deps; }
  private update(patch: Partial<VoiceState>) { this.state = { ...this.state, ...patch }; this.deps.onChange(this.state); }
  async start() {
    if (this.active) return;
    this.active = true;
    const generation = ++this.generation;
    const abort = new AbortController(); this.operation = abort;
    this.update({ ...INITIAL_VOICE, phase: "connecting" });
    try {
      const audio = await this.deps.openAudio({
        audio: (blob) => { if (this.active && generation === this.generation) void this.utterance(blob); },
        activity: (level, started) => {
          if (!this.active || generation !== this.generation || this.state.muted) return;
          if (started && this.state.phase === "speaking") this.interrupt();
          if (["listening", "hearing", "speaking"].includes(this.state.phase)) this.update({ level, ...(started ? { phase: "hearing" as const } : {}) });
        },
        error: (error) => { if (this.active && generation === this.generation) this.fail(error); },
      }, abort.signal);
      if (!this.active || generation !== this.generation) { audio.close(); return; }
      this.audio = audio; this.listen();
    } catch (e) { if (this.active && generation === this.generation) this.fail(e); }
  }
  private listen() {
    if (!this.active) return;
    this.update({ phase: this.state.muted ? "muted" : "listening", level: 0 });
    if (!this.state.muted) this.audio?.listen();
  }
  private async utterance(blob: Blob) {
    if (!this.active || this.state.muted || !["listening", "hearing"].includes(this.state.phase)) return;
    this.audio?.pause();
    const current = ++this.turn, abort = new AbortController();
    this.operation?.abort(); this.operation = abort;
    this.update({ phase: "transcribing", level: 0 });
    try {
      const text = (await this.deps.transcribe(blob, abort.signal)).trim();
      if (!this.current(current)) return;
      if (!text) { this.listen(); return; }
      await this.answer(text, current, abort);
    } catch (e) { if (this.current(current)) this.fail(e); }
  }
  async sendText(text: string) {
    if (!this.active || !text.trim() || ["connecting", "transcribing", "thinking", "waiting"].includes(this.state.phase)) return;
    this.audio?.pause(); this.operation?.abort();
    const current = ++this.turn, abort = new AbortController(); this.operation = abort;
    try { await this.answer(text.trim(), current, abort); }
    catch (e) { if (this.current(current)) this.fail(e); }
  }
  private current(turn: number) { return this.active && turn === this.turn; }
  private async answer(text: string, current: number, abort: AbortController) {
    this.update({ phase: "thinking", transcript: text, level: 0 });
    const reply = await this.deps.respond(text);
    if (!this.current(current)) return;
    if (!reply) throw new Error("Não foi possível enviar. Sua mensagem ficou no campo para tentar novamente.");
    if (reply.status === "waiting") { this.update({ phase: "waiting" }); return; }
    if (reply.status !== "completed") throw new Error(reply.error || "O fluxo não concluiu a resposta. Consulte as etapas no chat.");
    const chunks = speechChunks(reply.output);
    for (const chunk of chunks) {
      const bytes = await this.deps.synthesize(chunk, abort.signal);
      if (!this.current(current)) return;
      this.update({ phase: "speaking" });
      if (!this.state.muted) this.audio?.listen(true);
      await this.audio?.play(bytes, abort.signal);
      if (!this.current(current)) return;
    }
    this.audio?.pause(); this.listen();
  }
  // Interrompe somente a fala da resposta; ações já realizadas pelo fluxo não são repetidas.
  interrupt() {
    if (!this.active || this.state.phase !== "speaking") return;
    this.turn++; this.operation?.abort(); this.operation = null;
    this.listen();
  }
  setMuted(muted: boolean) {
    if (!this.active || this.state.phase === "connecting") return;
    this.update({ muted, level: 0 });
    if (muted) this.audio?.pause();
    if (["listening", "hearing", "muted"].includes(this.state.phase)) this.listen();
    else if (!muted && this.state.phase === "speaking") this.audio?.listen(true);
  }
  private release() {
    this.active = false; this.generation++; this.turn++;
    this.operation?.abort(); this.operation = null;
    this.audio?.close(); this.audio = null;
  }
  private fail(error: unknown) {
    this.release();
    this.update({ phase: "error", level: 0, error: error instanceof Error ? error.message : "A conversa por voz foi interrompida. Tente novamente." });
  }
  stop() { this.release(); this.update({ ...INITIAL_VOICE }); }
}

// Pausas curtas fazem parte da mesma frase. Ruído isolado não deve iniciar um turno.
export class VoiceActivity {
  private since = 0;
  private lastVoice = 0;
  private talking = false;
  private threshold: number;
  constructor(threshold = 0.018) { this.threshold = threshold; }
  setThreshold(threshold: number) { this.threshold = threshold; }
  sample(level: number, now: number): "start" | "end" | null {
    if (level >= this.threshold) {
      if (!this.since) this.since = now;
      this.lastVoice = now;
      if (!this.talking && now - this.since >= 180) { this.talking = true; return "start"; }
    } else {
      if (!this.talking) this.since = 0;
      if (this.talking && now - this.lastVoice >= 1000) { this.reset(); return "end"; }
    }
    return null;
  }
  reset() { this.since = 0; this.lastVoice = 0; this.talking = false; }
}
