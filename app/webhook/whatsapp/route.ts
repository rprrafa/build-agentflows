import { interpretarRecebidos, assinaturaMetaConfere } from "@/lib/whatsapp";
import { processarWhatsApp } from "@/lib/channel-flows";
import { channelApi } from "@/lib/channel-auth";
import { limitedText } from "@/lib/saas-http";
import { AuthError } from "@/lib/saas-security";
import { getConfig } from "@/lib/store";
import { provedorWhatsApp } from "@/lib/conexoes";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  return channelApi(req, "whatsapp", async () => {
    const q = new URL(req.url).searchParams;
    if (q.get("hub.mode") !== "subscribe") throw new AuthError("Verificação inválida.", 403);
    return new Response((q.get("hub.challenge") || "").slice(0, 512), { headers: { "Content-Type": "text/plain" } });
  });
}
export async function POST(req: Request) {
  return channelApi(req, "whatsapp", async () => {
    const raw = await limitedText(req, 300000);
    if (provedorWhatsApp() === "meta" && !assinaturaMetaConfere(raw, req.headers.get("x-hub-signature-256"), getConfig("WHATSAPP_APP_SECRET") || "")) throw new AuthError("Assinatura inválida.", 401);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { throw new AuthError("Aviso JSON inválido."); }
    for (const message of interpretarRecebidos(body)) await processarWhatsApp(message);
    return new Response("OK");
  });
}
