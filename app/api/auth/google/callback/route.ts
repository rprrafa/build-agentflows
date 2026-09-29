import { finishGoogleLogin } from "@/lib/saas-google";
import { saasDatabase } from "@/lib/saas-db";
import { appOrigin } from "@/lib/saas-security";
import { sessionCookie } from "@/lib/saas-http";
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const binding = req.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("agentflows_google="))?.slice("agentflows_google=".length);
  const headers = new Headers({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  headers.append("Set-Cookie", `agentflows_google=; HttpOnly; SameSite=Lax; Path=/api/auth/google; Max-Age=0${appOrigin().startsWith("https:") ? "; Secure" : ""}`);
  try {
    const { user, token } = await finishGoogleLogin(saasDatabase(), { state: params.get("state"), binding, code: params.get("code") });
    headers.append("Set-Cookie", sessionCookie(token));
    headers.set("Location", new URL(user.beta_status === "approved" ? "/" : "/acesso", appOrigin()).href);
  } catch {
    headers.set("Location", new URL("/entrar?erro=google", appOrigin()).href);
  }
  return new Response(null, { status: 303, headers });
}
