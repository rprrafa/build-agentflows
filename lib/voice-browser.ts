import { VoiceActivity, type VoiceAudio, type VoiceEvents } from "./voice-session";

export async function openVoiceAudio(events: VoiceEvents, signal: AbortSignal): Promise<VoiceAudio> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined" || typeof AudioContext === "undefined") throw new Error("Este navegador não oferece conversa por voz. Abra o app em HTTPS em um navegador atualizado.");
  const context = new AudioContext();
  // Liberar a saída durante o gesto de início evita bloqueios de reprodução automática.
  const ready = context.resume();
  let stream: MediaStream | undefined, cancelled = false;
  const cancelOpening = () => { cancelled = true; stream?.getTracks().forEach((t) => t.stop()); if (context.state !== "closed") void context.close(); };
  signal.addEventListener("abort", cancelOpening, { once: true });
  try {
    await Promise.all([ready, navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).then((value) => {
      stream = value;
      if (cancelled || signal.aborted) { value.getTracks().forEach((t) => t.stop()); throw new DOMException("Encerrado", "AbortError"); }
    })]);
    signal.throwIfAborted();
  } catch (e) {
    cancelOpening();
    if (e instanceof DOMException && e.name === "NotAllowedError") throw new Error("Permita o microfone no navegador para iniciar a conversa por voz.");
    throw new Error("Não foi possível abrir o microfone. Verifique se ele está disponível e tente novamente.");
  } finally { signal.removeEventListener("abort", cancelOpening); }
  const microphone = stream!;
  const source = context.createMediaStreamSource(microphone), analyser = context.createAnalyser();
  analyser.fftSize = 2048; source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((m) => MediaRecorder.isTypeSupported(m));
  let closed = false, listening = false, speaking = false, heard = false, started = 0;
  let recorder: MediaRecorder | null = null, detector = new VoiceActivity();
  let playback: AudioBufferSourceNode | null = null;
  const discard = () => {
    const old = recorder; recorder = null;
    if (old) { old.onstop = null; old.ondataavailable = null; old.onerror = null; try { if (old.state !== "inactive") old.stop(); } catch {} }
    detector.reset(); heard = false;
  };
  const record = () => {
    if (closed || !listening) return;
    discard();
    const chunks: Blob[] = [];
    let rec: MediaRecorder;
    try { rec = new MediaRecorder(microphone, mime ? { mimeType: mime } : undefined); }
    catch { events.error(new Error("Não foi possível iniciar a gravação neste navegador.")); return; }
    recorder = rec;
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onerror = () => { if (!closed) events.error(new Error("A gravação foi interrompida. Verifique seu microfone.")); };
    rec.onstop = () => {
      if (closed || rec !== recorder) return;
      recorder = null; listening = false;
      const blob = new Blob(chunks, { type: rec.mimeType });
      if (blob.size) events.audio(blob);
    };
    started = performance.now(); heard = false;
    try { rec.start(250); } catch { events.error(new Error("Não foi possível iniciar a gravação. Tente novamente.")); }
  };
  const timer = setInterval(() => {
    if (closed || !listening || !recorder || recorder.state !== "recording") return;
    analyser.getFloatTimeDomainData(samples);
    const level = Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
    const now = performance.now(), activity = detector.sample(level, now);
    if (activity === "start") heard = true;
    events.activity(Math.min(1, level * 9), activity === "start");
    if (activity === "end" || (heard && now - started >= 45000)) { recorder?.stop(); return; }
    // Mantém um início de arquivo decodificável sem acumular minutos de silêncio.
    if (!heard && level < 0.008 && now - started >= 8000) record();
  }, 50);
  for (const track of microphone.getTracks()) track.onended = () => { if (!closed) events.error(new Error("O microfone foi desconectado. Conecte-o e inicie a voz novamente.")); };
  return {
    listen(interruptible = false) {
      if (closed) return;
      // Ao interromper a resposta, preservar o começo da fala já capturado.
      if (listening && recorder?.state === "recording") { speaking = interruptible; detector.setThreshold(speaking ? 0.035 : 0.018); return; }
      speaking = interruptible;
      detector = new VoiceActivity(speaking ? 0.035 : 0.018);
      listening = true; microphone.getAudioTracks().forEach((t) => { t.enabled = true; }); record();
    },
    pause() { listening = false; discard(); microphone.getAudioTracks().forEach((t) => { t.enabled = false; }); },
    async play(bytes, signal) {
      if (closed || signal.aborted) return;
      const buffer = await context.decodeAudioData(bytes);
      if (closed || signal.aborted) return;
      await context.resume();
      if (closed || signal.aborted) return;
      await new Promise<void>((resolve, reject) => {
        const node = context.createBufferSource(); playback = node; node.buffer = buffer; node.connect(context.destination);
        let done = false;
        const finish = (error?: unknown) => { if (done) return; done = true; node.onended = null; signal.removeEventListener("abort", cancel); node.disconnect(); if (playback === node) playback = null; if (error) reject(error); else resolve(); };
        const cancel = () => { try { node.stop(); } catch {} finish(); };
        node.onended = () => finish(); signal.addEventListener("abort", cancel, { once: true });
        try { node.start(); } catch (e) { finish(e); }
      });
    },
    close() {
      if (closed) return;
      closed = true; clearInterval(timer); discard();
      try { playback?.stop(); } catch {}
      source.disconnect(); analyser.disconnect();
      microphone.getTracks().forEach((t) => { t.onended = null; t.stop(); });
      void context.close();
    },
  };
}
