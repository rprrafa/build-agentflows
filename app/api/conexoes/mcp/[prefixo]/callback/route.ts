import { servidorMCP } from "@/lib/conexoes";
import { trocarCode } from "@/lib/mcp-oauth";
import { appOrigin } from "@/lib/saas-security";
import { requestApi } from "@/lib/flow-api";
import { consumeIntegrationOAuth } from "@/lib/tenant-oauth";
type Context = { params: Promise<{ prefixo: string }> };
async function complete(req: Request, c: Context) {
  const { prefixo } = await c.params;
  const url = new URL(req.url);
  const voltar = (erro?: string) =>
    new Response(null, {
      status: 302,
      headers: {
        Location: erro
          ? `${appOrigin()}/ferramentas?erro=${encodeURIComponent(erro)}`
          : `${appOrigin()}/ferramentas?conectado=${encodeURIComponent(prefixo)}`,
        "Set-Cookie": `mcp_${prefixo}_verifier=; Path=/; Max-Age=0`,
      },
    });
  try {
    const s = servidorMCP(prefixo);
    const recusa = url.searchParams.get("error_description") || url.searchParams.get("error");
    if (recusa) return voltar(`O serviço recusou a autorização de “${s.nome}”.`);
    const code = url.searchParams.get("code");
    const verifier = new RegExp(`(?:^|;\\s*)mcp_${prefixo}_verifier=([^;]+)`).exec(
      req.headers.get("cookie") || "",
    )?.[1];
    if (!code || !verifier) return voltar("A autorização expirou. Tente de novo.");
    await consumeIntegrationOAuth(`mcp:${prefixo}:${s.url}`, url.searchParams.get("state"), verifier);
    await trocarCode(prefixo, code, verifier, `${appOrigin()}/api/conexoes/mcp/${prefixo}/callback`);
    return voltar();
  } catch (err) {
    return voltar(err instanceof Error ? err.message : "Falha ao concluir a autorização.");
  }
}
export async function GET(req: Request, c: Context) { return requestApi(req, () => complete(req, c)); }
