// Avisos do WhatsApp (Z-API, Meta e ZapperHub) chegam aqui. Rota pública (proxy.ts, `/webhook/**`),
// protegida pela chave secreta na URL (?chave=) gerada em Configurações; a Meta também usa essa chave
// como valor de verificação. Cada mensagem de texto executa o fluxo publicado escolhido em
// Conexões e a resposta volta pelo mesmo número. Responde 200 na hora e processa em seguida.
import { chaveConfere, interpretarRecebido } from "@/lib/whatsapp";
import { processarWhatsApp } from "@/lib/channel-flows";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  if (q.get("hub.mode") === "subscribe" && chaveConfere(q.get("hub.verify_token")))
    return new Response(q.get("hub.challenge") || "", { status: 200, headers: { "Content-Type": "text/plain" } });
  return new Response(null, { status: 403 });
}
export async function POST(req: Request) {
  const q = new URL(req.url).searchParams;
  if (!chaveConfere(q.get("chave"))) {
    console.error("Aviso do WhatsApp recusado: chave ausente ou diferente.");
    return new Response(null, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const recebida = interpretarRecebido(body);
  if (recebida) processarWhatsApp(recebida).catch((err) => console.error("Erro ao responder no WhatsApp:", err));
  return new Response("OK", { status: 200 });
}
