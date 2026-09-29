// Conexão em um clique com o OpenRouter (PKCE): gera o verificador, guarda em cookie e redireciona.
import { createHash, randomBytes } from "node:crypto";
import { appOrigin } from "@/lib/saas-security";
import { setConfig } from "@/lib/store";
import { requestApi } from "@/lib/flow-api";
import { beginIntegrationOAuth } from "@/lib/tenant-oauth";
async function start() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const callbackUrl = new URL(`${appOrigin()}/api/conexoes/openrouter/callback`);
  callbackUrl.searchParams.set("state", await beginIntegrationOAuth("openrouter", verifier));
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
export async function GET(req: Request) { return requestApi(req, start); }
export async function DELETE(req?: Request) {
  return requestApi(req, () => {
    setConfig("OPENROUTER_API_KEY", null);
    return { ok: true };
  });
}
