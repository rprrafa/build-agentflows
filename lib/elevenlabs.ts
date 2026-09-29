// Voz com ElevenLabs: transcrição (falar no chat), fala (ouvir a resposta) e ligações telefônicas
// pelo agente de conversa (Conversational AI + Twilio/SIP). O aviso de fim de ligação chega em
// /webhook/elevenlabs assinado com HMAC e executa o fluxo escolhido em Configurações com a transcrição.
import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig } from "./store";
import { FlowError } from "./flow-store";
import type { Resultado } from "./conexoes-teste";
const BASE = "https://api.elevenlabs.io/v1";
export const MODELO_FALA = "eleven_flash_v2_5";
export const MODELO_TRANSCRICAO = "scribe_v1";
export const VOZ_PADRAO = "21m00Tcm4TlvDq8ikWAM";
function chave() {
  const k = getConfig("ELEVENLABS_API_KEY");
  if (!k) throw new FlowError("Conecte a ElevenLabs em Configurações.");
  return k;
}
function falha(status: number, detalhe: string) {
  if (status === 401) return new FlowError("A ElevenLabs recusou a chave. Confira em Configurações.", 401);
  if (status === 402 || /quota|credits|limit/i.test(detalhe))
    return new FlowError("A conta da ElevenLabs está sem créditos ou atingiu o limite.", 402);
  if (status === 404) return new FlowError("A ElevenLabs não encontrou a voz, o agente ou o número informado.", 404);
  if (status === 422 || status === 400) return new FlowError("A ElevenLabs recusou o pedido. Confira a voz, o agente e o número.", 400);
  return new FlowError("A ElevenLabs não respondeu agora. Tente de novo em instantes.", 502);
}
async function chamar(caminho: string, init: RequestInit = {}): Promise<Response> {
  const k = chave();
  let r: Response;
  try {
    r = await fetch(`${BASE}${caminho}`, {
      ...init,
      headers: { "xi-api-key": k, ...(init.headers || {}) },
      signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000),
    });
  } catch {
    throw new FlowError("Não foi possível falar com a ElevenLabs agora.", 503);
  }
  if (!r.ok) throw falha(r.status, await r.text().catch(() => ""));
  return r;
}
export function falaDisponivel() {
  return !!getConfig("ELEVENLABS_API_KEY");
}
export function ligacaoDisponivel() {
  return !!getConfig("ELEVENLABS_API_KEY") && !!getConfig("ELEVENLABS_AGENT_ID") && !!getConfig("ELEVENLABS_PHONE_NUMBER_ID");
}
export async function vozes(): Promise<{ id: string; nome: string }[]> {
  const r = await chamar("/voices");
  const d = (await r.json()) as { voices?: { voice_id: string; name: string }[] };
  return (d.voices || []).map((v) => ({ id: v.voice_id, nome: v.name }));
}
export async function falar(texto: string, vozEscolhida?: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const t = texto.trim().slice(0, 2500);
  if (!t) throw new FlowError("Nada para falar.");
  const voz = (vozEscolhida || "").replace(/[^a-zA-Z0-9_-]/g, "") || getConfig("ELEVENLABS_VOICE_ID") || VOZ_PADRAO;
  const r = await chamar(`/text-to-speech/${encodeURIComponent(voz)}?output_format=mp3_44100_128`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text: t, model_id: MODELO_FALA }),
  });
  return r.arrayBuffer();
}
export async function transcrever(audio: Blob, signal?: AbortSignal): Promise<string> {
  if (!audio.size) throw new FlowError("Nenhum áudio recebido.");
  if (audio.size > 15_000_000) throw new FlowError("Áudio grande demais (máximo 15 MB).");
  const form = new FormData();
  form.set("model_id", MODELO_TRANSCRICAO);
  form.set("language_code", "por");
  const ext = audio.type.includes("mp4") ? "m4a" : audio.type.includes("ogg") ? "ogg" : audio.type.includes("wav") ? "wav" : "webm";
  form.set("file", audio, `audio.${ext}`);
  const r = await chamar("/speech-to-text", { method: "POST", body: form, signal });
  const d = (await r.json()) as { text?: string };
  return (d.text || "").trim();
}
export async function ligar(telefone: string, contexto: string): Promise<{ ok: boolean; conversationId?: string; callSid?: string }> {
  const numero = telefone.replace(/[^\d+]/g, "");
  if (numero.replace(/\D/g, "").length < 10) throw new FlowError("Informe o telefone com DDI e DDD.");
  const agent = getConfig("ELEVENLABS_AGENT_ID"),
    phone = getConfig("ELEVENLABS_PHONE_NUMBER_ID");
  if (!agent || !phone) throw new FlowError("Informe o agente de conversa e o número em Configurações.");
  const r = await chamar("/convai/twilio/outbound-call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_id: agent,
      agent_phone_number_id: phone,
      to_number: numero.startsWith("+") ? numero : "+" + numero,
      conversation_initiation_client_data: { dynamic_variables: { contexto: contexto.slice(0, 4000), telefone: numero } },
    }),
  });
  const d = (await r.json().catch(() => ({}))) as { success?: boolean; conversation_id?: string; callSid?: string };
  return { ok: d.success !== false, conversationId: d.conversation_id, callSid: d.callSid };
}
// Assinatura do aviso pós-ligação: "ElevenLabs-Signature: t=<segundos>,v0=<hmac-sha256 de "t.corpo">".
export function assinaturaConfere(corpo: string, cabecalho: string | null, segredo: string, agora = Date.now()): boolean {
  if (!cabecalho || !segredo) return false;
  const partes = Object.fromEntries(cabecalho.split(",").map((p) => p.trim().split("=") as [string, string]));
  const t = Number(partes.t);
  if (!t || Math.abs(agora / 1000 - t) > 30 * 60) return false;
  const esperado = createHmac("sha256", segredo).update(`${t}.${corpo}`).digest("hex");
  const a = Buffer.from(esperado),
    b = Buffer.from(String(partes.v0 || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}
export type PosLigacao = { conversationId: string; transcricao: string; resumo?: string; telefone?: string; variaveis: Record<string, string> };
export function interpretarPosLigacao(body: unknown): PosLigacao | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { type?: string; data?: Record<string, unknown> };
  if (b.type !== "post_call_transcription" || !b.data) return null;
  const d = b.data;
  const falas = (d.transcript as { role?: string; message?: string }[] | undefined) || [];
  const transcricao = falas
    .filter((f) => f.message)
    .map((f) => `${f.role === "agent" ? "Agente" : "Pessoa"}: ${f.message}`)
    .join("\n");
  const analise = d.analysis as { transcript_summary?: string } | undefined;
  const meta = d.metadata as { phone_call?: { external_number?: string } } | undefined;
  const init = d.conversation_initiation_client_data as { dynamic_variables?: Record<string, unknown> } | undefined;
  const variaveis = Object.fromEntries(
    Object.entries(init?.dynamic_variables || {}).map(([k, v]) => [k, String(v ?? "")]),
  );
  return {
    conversationId: String(d.conversation_id || ""),
    transcricao,
    resumo: analise?.transcript_summary,
    telefone: meta?.phone_call?.external_number || variaveis.telefone,
    variaveis,
  };
}
export async function testarElevenLabs(): Promise<Resultado> {
  if (!getConfig("ELEVENLABS_API_KEY")) return { ok: false, mensagem: "Salve a chave da ElevenLabs." };
  try {
    const r = await chamar("/user/subscription");
    const d = (await r.json()) as { character_count?: number; character_limit?: number; tier?: string };
    const restante = d.character_limit != null ? Math.max(0, d.character_limit - (d.character_count || 0)) : null;
    const partes = [`Conectado${d.tier ? ` (plano ${d.tier})` : ""}.`];
    if (restante != null) partes.push(`${restante.toLocaleString("pt-BR")} caracteres de fala restantes no ciclo.`);
    partes.push(ligacaoDisponivel() ? "Ligações habilitadas." : "Para ligações, informe o agente de conversa e o número.");
    return { ok: true, mensagem: partes.join(" ") };
  } catch (err) {
    return { ok: false, mensagem: err instanceof Error ? err.message : "A ElevenLabs não respondeu." };
  }
}
