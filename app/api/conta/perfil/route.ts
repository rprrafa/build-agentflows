import { sessaoAtual } from "@/lib/conta";
import { saasEnabled } from "@/lib/tenant-context";
import { findSession } from "@/lib/saas-auth";
import { saasDatabase } from "@/lib/saas-db";
import { privateJson, sessionToken } from "@/lib/saas-http";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  if (saasEnabled()) {
    const user = await findSession(saasDatabase(), sessionToken(req));
    return privateJson(user ? { usuario: { nome: user.name } } : { error: "Entre na sua conta." }, { status: user ? 200 : 401 });
  }
  const usuario = sessaoAtual(req);
  return Response.json(usuario ? { usuario: { nome: usuario.nome } } : { error: "Entre na sua conta." }, {
    status: usuario ? 200 : 401, headers: { "Cache-Control": "private, no-store" },
  });
}
