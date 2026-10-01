// Volta do OpenRouter: troca o código pela chave e grava no banco cifrado.
import { saveOpenRouterOAuth } from "@/lib/ai-credentials";
import { requestApi } from "@/lib/flow-api";
import { consumeIntegrationOAuth } from "@/lib/tenant-oauth";
async function complete(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const cookie = req.headers.get("cookie") || "";
  const verifier = /(?:^|;\s*)or_verifier=([^;]+)/.exec(cookie)?.[1];
  let popup = false;
  let credentialId = "";
  const voltar = (erro?: string) =>
    new Response(null, {
      status: 302,
      headers: {
        Location: popup
          ? `/credenciais/openrouter?${new URLSearchParams(erro ? { erro } : { credentialId })}`
          : erro ? `/credenciais?erro=${encodeURIComponent(erro)}` : "/credenciais?conectado=openrouter",
        "Set-Cookie": "or_verifier=; Path=/; Max-Age=0",
      },
    });
  if (!code || !verifier)
    return voltar("A conexão com o OpenRouter expirou. Tente de novo.");
  try {
    const context = await consumeIntegrationOAuth("openrouter", url.searchParams.get("state"), verifier);
    popup = !!context?.popup;
    const r = await fetch("https://openrouter.ai/api/v1/auth/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
      signal: AbortSignal.timeout(20000), redirect: "error",
    });
    const data = r.ok ? ((await r.json()) as { key?: string }) : {};
    if (!data.key)
      return voltar("O OpenRouter não concluiu a conexão. Tente de novo.");
    credentialId = saveOpenRouterOAuth(data.key).id;
    return voltar();
  } catch (err) {
    void err;
    return voltar("Falha ao concluir a conexão com o OpenRouter.");
  }
}
export async function GET(req: Request) { return requestApi(req, () => complete(req)); }
