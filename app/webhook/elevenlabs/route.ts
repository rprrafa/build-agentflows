import { getConfig } from "@/lib/store";
import { assinaturaConfere, interpretarPosLigacao } from "@/lib/elevenlabs";
import { processarLigacao } from "@/lib/channel-flows";
import { channelApi } from "@/lib/channel-auth";
import { limitedText } from "@/lib/saas-http";
import { AuthError } from "@/lib/saas-security";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  return channelApi(req, "elevenlabs", async () => {
    const raw = await limitedText(req, 1048576);
    if (!assinaturaConfere(raw, req.headers.get("elevenlabs-signature"), getConfig("ELEVENLABS_WEBHOOK_SECRET") || "")) throw new AuthError("Assinatura inválida.", 401);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { throw new AuthError("Aviso JSON inválido."); }
    const call = interpretarPosLigacao(body);
    if (call) await processarLigacao(call);
    return new Response("OK");
  });
}
