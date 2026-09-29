// Autorizar (OAuth do servidor MCP) e remover um servidor de ferramentas.
import { removerServidorMCP, servidorMCP, atualizarServidorMCP } from "@/lib/conexoes";
import { iniciarAutorizacao } from "@/lib/mcp-oauth";
import { baseUrl } from "@/lib/setup-comum";
import { requestApi, body } from "@/lib/flow-api";
import { tenantId } from "@/lib/tenant-context";
import { beginIntegrationOAuth } from "@/lib/tenant-oauth";
type C = { params: Promise<{ prefixo: string }> };
async function start(req: Request, c: C) {
  const { prefixo } = await c.params;
  const voltar = (erro: string) =>
    Response.redirect(`${baseUrl(req)}/ferramentas?erro=${encodeURIComponent(erro)}`, 302);
  try {
    const s = servidorMCP(prefixo);
    const redirectUri = `${baseUrl(req)}/api/conexoes/mcp/${prefixo}/callback`;
    const { destino, verifier } = await iniciarAutorizacao(prefixo, s.url, redirectUri);
    const target = new URL(destino);
    if (tenantId()) target.searchParams.set("state", await beginIntegrationOAuth(`mcp:${prefixo}:${s.url}`, verifier));
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
export async function GET(req: Request, c: C) { return requestApi(req, () => start(req, c)); }
export async function DELETE(req: Request, c: C) {
  return requestApi(req, async () => {
    removerServidorMCP((await c.params).prefixo);
    return { ok: true };
  });
}

export async function PUT(req: Request, c: C) {
  return requestApi(req, async () => { const b = await body(req); atualizarServidorMCP((await c.params).prefixo, b.nome, b.url, b.codigo); return { ok: true }; });
}
