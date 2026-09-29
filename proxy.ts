import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withEmbedOwner } from "@/lib/embed-http";
import { effectiveEmbedOrigins } from "@/lib/embed-security";
import { embedSettings, hasEmbedKey } from "@/lib/embed-store";
import { findSession } from "@/lib/saas-auth";
import { saasDatabase } from "@/lib/saas-db";
import { sessionToken } from "@/lib/saas-http";

function rotaPublica(pathname: string, metodo: string): boolean {
  // Embed APIs authenticate signed, scoped tickets; no admin cookie crosses origins.
  if (pathname === "/embed.js" || /^\/embed\/[a-zA-Z0-9-]+$/.test(pathname)) return true;
  if (pathname === "/api/embed/token" || pathname === "/api/embed/session" || pathname === "/api/embed/attachments" || /^\/api\/embed\/attachments\/[a-zA-Z0-9-]+$/.test(pathname)) return true;
  if (pathname === "/mcp") return metodo === "POST" || metodo === "GET";
  if (pathname === "/api/health") return true;
  if (pathname === "/conta" || pathname === "/entrar") return true;
  if (pathname === "/icon.svg") return true;
  if (pathname === "/webhook/whatsapp" || pathname === "/webhook/elevenlabs" || /^\/webhook\/flows\/[a-zA-Z0-9-]+$/.test(pathname)) return true;
  if (pathname.startsWith("/_next/")) return true;
  return false;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  async function permitir() {
    const response = NextResponse.next();
    if (pathname.startsWith("/embed/") || pathname.startsWith("/api/embed/")) response.headers.set("Cache-Control", "no-store");
    if (/^\/embed\/[a-zA-Z0-9-]+$/.test(pathname)) {
      try { const s = await withEmbedOwner(pathname.split("/")[2], async () => { const settings = await embedSettings(pathname.split("/")[2]); return { ...settings, enabled: settings.enabled && hasEmbedKey(pathname.split("/")[2]), origins: effectiveEmbedOrigins(settings.origins) }; }); response.headers.set("Content-Security-Policy", "frame-ancestors " + (s.enabled ? "'self' " + s.origins.join(" ") : "'none'") + ";"); }
      catch { response.headers.set("Content-Security-Policy", "frame-ancestors 'none';"); }
      response.headers.set("Referrer-Policy", "no-referrer");
    }
    return response;
  }

  const publicAuth = ["/entrar", "/conta", "/acesso", "/verificar-email", "/recuperar-senha", "/redefinir-senha"];
  if (publicAuth.includes(pathname) || pathname.startsWith("/api/auth/") || pathname.startsWith("/_next/") || pathname === "/icon.svg" || pathname === "/api/health") return permitir();
  // Public integrations keep their own token/owner validation in their handlers.
  if (rotaPublica(pathname, request.method)) return permitir();
  try {
    const user = await findSession(saasDatabase(), sessionToken(request));
    if (user?.email_verified_at && user.beta_status === "approved") return permitir();
    if (pathname.startsWith("/api/") || pathname === "/mcp") return NextResponse.json({ error: user ? "Acesso ao beta pendente ou suspenso." : "Entre na sua conta." }, { status: user ? 403 : 401 });
    return NextResponse.redirect(new URL(user ? "/acesso" : "/entrar", request.url));
  } catch { return NextResponse.json({ error: "Serviço temporariamente indisponível." }, { status: 503 }); }
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
