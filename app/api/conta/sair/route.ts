// Encerra a sessão atual. Compartilhado: copie sem alterar.
import { COOKIE_SESSAO, cookieDeSaida, lerCookie, sair } from "@/lib/conta";
import { baseUrl } from "@/lib/setup-comum";
import { saasEnabled } from "@/lib/tenant-context";
import { authAction } from "@/lib/saas-http";
import { saasDatabase } from "@/lib/saas-db";

export async function POST(req: Request) {
  if (saasEnabled()) return authAction(saasDatabase(), req, "logout");
  const token = lerCookie(req.headers.get("cookie"), COOKIE_SESSAO);
  sair(token);
  const seguro = baseUrl(req).startsWith("https");
  return Response.json({ ok: true }, { headers: { "Set-Cookie": cookieDeSaida(seguro) } });
}
