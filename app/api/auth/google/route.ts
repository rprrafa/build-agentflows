import { beginGoogleLogin } from "@/lib/saas-google";
import { saasDatabase } from "@/lib/saas-db";
import { appOrigin } from "@/lib/saas-security";
import { httpError } from "@/lib/saas-http";
import { rateLimitClient } from "@/lib/saas-rate-limit";
export async function GET(req: Request) {
  try {
    const { url, binding } = await beginGoogleLogin(saasDatabase(), rateLimitClient(req.headers));
    return new Response(null, { status: 303, headers: {
      Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
      "Set-Cookie": `agentflows_google=${binding}; HttpOnly; SameSite=Lax; Path=/api/auth/google; Max-Age=600${appOrigin().startsWith("https:") ? "; Secure" : ""}`,
    } });
  } catch (error) { return httpError(error); }
}
