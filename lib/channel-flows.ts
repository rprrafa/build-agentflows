import { getConfig, setConfig } from "./store";
import type { PosLigacao } from "./elevenlabs";
import { enviarMensagem, type Recebida } from "./whatsapp";
import { whatsappConfigurado, provedorWhatsApp } from "./conexoes";
import { startRun } from "./flow-runtime";

export function textoDaLigacao(l: PosLigacao) {
  return [
    l.telefone ? `Telefone: ${l.telefone}` : "",
    l.resumo ? `Resumo: ${l.resumo}` : "",
    l.variaveis.contexto ? `Contexto da ligação: ${l.variaveis.contexto}` : "",
    "",
    "Transcrição:",
    l.transcricao || "(sem falas registradas)",
  ]
    .filter((linha, i, arr) => linha !== "" || (i > 0 && arr[i - 1] !== ""))
    .join("\n")
    .trim();
}
export async function processarLigacao(l: PosLigacao) {
  setConfig("ELEVENLABS_ULTIMA_LIGACAO", JSON.stringify({ em: new Date().toISOString(), id: l.conversationId }));
  const flowId = getConfig("ELEVENLABS_FLOW_ID");
  if (!flowId) return null;
  return startRun(flowId, textoDaLigacao(l), true);
}

// Executa o fluxo escolhido em Configurações com o texto recebido e devolve a resposta ao remetente.
export async function processarWhatsApp(m: Recebida): Promise<string | null> {
  if (!whatsappConfigurado() || m.provedor !== provedorWhatsApp()) return null;
  setConfig("WHATSAPP_ULTIMA_RECEBIDA", JSON.stringify({ em: new Date().toISOString(), de: m.de }));
  const flowId = getConfig("WHATSAPP_FLOW_ID");
  if (!flowId) return null;
  let resposta: string;
  try {
    const r = await startRun(flowId, m.texto, true);
    resposta =
      r.status === "completed"
        ? r.output
        : r.status === "waiting"
          ? "Recebi sua mensagem. Ela está em análise e voltamos em breve."
          : "Não consegui concluir agora. Tente novamente em instantes.";
  } catch (err) {
    console.error("Fluxo do WhatsApp falhou:", err);
    resposta = "Não consegui concluir agora. Tente novamente em instantes.";
  }
  if (resposta.trim()) await enviarMensagem(m.de, resposta);
  return resposta;
}
