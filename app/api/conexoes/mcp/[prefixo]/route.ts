// Autorizar (OAuth do servidor MCP) e remover um servidor de ferramentas.
import { removerServidorMCP, servidorMCP, atualizarServidorMCP } from "@/lib/conexoes";
import { iniciarAutorizacao } from "@/lib/mcp-oauth";
import { appOrigin } from "@/lib/saas-security";
import { requestApi, body } from "@/lib/flow-api";
import { beginIntegrationOAuth } from "@/lib/tenant-oauth";
type C = { params: Promise<{ prefixo: string }> };
async function start(c: C) {
  const { prefixo } = await c.params;
  const voltar = (erro: string) =>
    Response.redirect(`${appOrigin()}/ferramentas?erro=${encodeURIComponent(erro)}`, 302);
  try {
    const s = servidorMCP(prefixo);
    const redirectUri = `${appOrigin()}/api/conexoes/mcp/${prefixo}/callback`;
    const { destino, verifier } = await iniciarAutorizacao(prefixo, s.url, redirectUri);
    const target = new URL(destino);
    target.searchParams.set("state", await beginIntegrationOAuth(`mcp:${prefixo}:${s.url}`, verifier));
    const seguro = redirectUri.startsWith("https") ? "; Secure" : "";
    return new Response(null, {
      status: 302,
      headers: {
        Location: target.toString(),
        "Set-Cookie": `mcp_${prefixo}_verifier=${verifier}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${seguro}`,
      },
    });
  } catch (err) {
    return voltar(
      err instanceof Error ? err.message : "Não foi possível iniciar a autorização.",
    );
  }
}
export async function GET(req: Request, c: C) { return requestApi(req, () => start(c)); }
export async function DELETE(req: Request, c: C) {
  return requestApi(req, async () => {
    removerServidorMCP((await c.params).prefixo);
    return { ok: true };
  });
}

export async function PUT(req: Request, c: C) {
  return requestApi(req, async () => { const b = await body(req); atualizarServidorMCP((await c.params).prefixo, b.nome, b.url, b.codigo); return { ok: true }; });
}
