// Aviso de fim de ligação da ElevenLabs (post_call_transcription). Rota pública (proxy.ts),
// validada pela assinatura HMAC com o segredo colado em Configurações. Executa o fluxo escolhido com a
// transcrição da ligação (inbound ou outbound) para registrar, classificar ou dar sequência.
import { getConfig } from "@/lib/store";
import { assinaturaConfere, interpretarPosLigacao } from "@/lib/elevenlabs";
import { processarLigacao } from "@/lib/channel-flows";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const corpo = await req.text();
  const segredo = getConfig("ELEVENLABS_WEBHOOK_SECRET") || "";
  if (!assinaturaConfere(corpo, req.headers.get("elevenlabs-signature"), segredo)) {
    console.error("Aviso da ElevenLabs recusado: assinatura ausente ou inválida.");
    return new Response(null, { status: 401 });
  }
  let body: unknown = null;
  try {
    body = JSON.parse(corpo);
  } catch {}
  const ligacao = interpretarPosLigacao(body);
  if (ligacao) processarLigacao(ligacao).catch((err) => console.error("Erro ao processar fim de ligação:", err));
  return new Response("OK", { status: 200 });
}
