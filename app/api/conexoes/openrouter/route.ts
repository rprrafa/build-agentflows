// Conexão em um clique com o OpenRouter (PKCE): gera o verificador, guarda em cookie e redireciona.
import { createHash, randomBytes } from "node:crypto";
import { baseUrl } from "@/lib/setup-comum";
import { setConfig } from "@/lib/store";
import { requestApi } from "@/lib/flow-api";
import { tenantId } from "@/lib/tenant-context";
import { beginIntegrationOAuth } from "@/lib/tenant-oauth";
async function start(req: Request) {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const callbackUrl = new URL(`${baseUrl(req)}/api/conexoes/openrouter/callback`);
  if (tenantId()) callbackUrl.searchParams.set("state", await beginIntegrationOAuth("openrouter", verifier));
  const callback = callbackUrl.toString();
  const destino = new URL("https://openrouter.ai/auth");
  destino.searchParams.set("callback_url", callback);
  destino.searchParams.set("code_challenge", challenge);
  destino.searchParams.set("code_challenge_method", "S256");
  const seguro = callback.startsWith("https") ? "; Secure" : "";
  return new Response(null, {
    status: 302,
    headers: {
      Location: destino.toString(),
      "Set-Cookie": `or_verifier=${verifier}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${seguro}`,
    },
  });
}
export async function GET(req: Request) { return requestApi(req, () => start(req)); }
export async function DELETE(req?: Request) {
  return requestApi(req, () => {
    setConfig("OPENROUTER_API_KEY", null);
    return { ok: true };
  });
}
