// Único proxy da suíte: (1) mantém Cache-Control: no-store nos formulários públicos por link
// (`/f/**`, `/api/f/**`, dado sensível servido por token); (2) exige a sessão da conta
// administrativa em toda tela/rota fora da lista pública abaixo. Copie sem alterar ao replicar.
//
// Cada rota pública tem seu próprio mecanismo de autenticação — nenhuma delas depende do
// cookie de sessão:
// - `/f/*`, `/api/f/*`            formulário público por link (o token já está na própria URL)
// - `/s/*`                        página estática gerada e servida ao público (ex.: clone-site)
// - `/api/videos/imagem/*`        imagem que o provedor de vídeo busca por endereço quando não aceita
//                                 upload direto (ex.: videos-campanha): quem chama é o servidor do
//                                 provedor, sem cookie nenhum; o id da campanha já está na própria URL
// - `/webhook`, `/webhook/*`      chamado por um serviço externo, validado por mecanismo próprio
//                                 (assinatura HMAC na ElevenLabs; verify token da Meta no
//                                 whatsapp-atendente, cujo endereço é `/webhook` sem sufixo)
// - `/simular/*`, `/api/salas/*`  sala de treino aberta por link (o token já está na própria URL):
//                                 quem treina é o vendedor, que não tem conta de administrador
// - `/entrevista/*`,              sala de entrevista aberta por link (o token já está na própria URL):
//   `/api/entrevista/candidato/*` quem responde é o candidato, que não tem conta de administrador
// - `/mcp`, só `POST`             JSON-RPC do MCP, validado por código de acesso (Bearer)
// - `/api/rotinas/executar`       gatilho externo de rotina, validado por código de acesso próprio
// - `/api/setup/oauth/*/callback` callback de um provedor OAuth externo
// - `/api/health`                 sonda de disponibilidade
// - `/setup/trello`               tela pública de instrução do OAuth do Trello, sem dado sensível
// - `/conta`, `/entrar`, `/api/conta/*`   as próprias telas/rotas de autenticação
// - `/_next/*`, `/icon.svg`       assets do framework
//
// A geração do código de acesso em `/api/mcp/token` NÃO está nessa lista: continua exigindo sessão.
//
// `CONTA_DESLIGADA=1` trata toda rota como pública (usado só pelo contêiner efêmero que captura a
// prévia do app para o catálogo; nunca definida em Blueprint nem em instância real).
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { effectiveEmbedOrigins } from "@/lib/embed-security";
import { embedSettings } from "@/lib/embed-store";
import { existeConta, sessaoAtual } from "@/lib/conta";
import { saasEnabled } from "@/lib/tenant-context";
import { findSession } from "@/lib/saas-auth";
import { saasDatabase } from "@/lib/saas-db";
import { sessionToken } from "@/lib/saas-http";

function rotaPublica(pathname: string, metodo: string): boolean {
  // Embed APIs authenticate signed, scoped tickets; no admin cookie crosses origins.
  if (pathname === "/embed.js" || /^\/embed\/[a-zA-Z0-9-]+$/.test(pathname)) return true;
  if (pathname === "/api/embed/token" || pathname === "/api/embed/session" || pathname === "/api/embed/attachments" || /^\/api\/embed\/attachments\/[a-zA-Z0-9-]+$/.test(pathname)) return true;
  if (pathname === "/mcp") return metodo === "POST";
  if (pathname === "/api/health") return true;
  if (pathname === "/api/rotinas/executar") return true;
  if (pathname === "/setup/trello") return true;
  if (pathname === "/conta" || pathname === "/entrar") return true;
  if (pathname === "/icon.svg") return true;
  if (pathname.startsWith("/f/") || pathname.startsWith("/api/f/")) return true;
  if (pathname.startsWith("/s/")) return true;
  if (pathname.startsWith("/api/videos/imagem/")) return true;
  if (pathname === "/webhook" || pathname.startsWith("/webhook/")) return true;
  if (pathname.startsWith("/simular/") || pathname.startsWith("/api/salas/")) return true;
  if (pathname.startsWith("/entrevista/") || pathname.startsWith("/api/entrevista/candidato/")) return true;
  if (pathname === "/api/conta" || pathname.startsWith("/api/conta/")) return true;
  if (pathname.startsWith("/_next/")) return true;
  if (/^\/api\/setup\/oauth\/[^/]+\/callback$/.test(pathname)) return true;
  return false;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const semCache = pathname.startsWith("/f/") || pathname.startsWith("/api/f/");

  function permitir() {
    const response = NextResponse.next();
    if (semCache || pathname.startsWith("/embed/") || pathname.startsWith("/api/embed/")) response.headers.set("Cache-Control", "no-store");
    if (/^\/embed\/[a-zA-Z0-9-]+$/.test(pathname)) {
      try { const s = embedSettings(pathname.split("/")[2]); s.origins = effectiveEmbedOrigins(s.origins); response.headers.set("Content-Security-Policy", "frame-ancestors " + (s.enabled && s.origins.length ? s.origins.join(" ") : "'none'") + ";"); }
      catch { response.headers.set("Content-Security-Policy", "frame-ancestors 'none';"); }
      response.headers.set("Referrer-Policy", "no-referrer");
    }
    return response;
  }

  if (saasEnabled()) {
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
  if (process.env.CONTA_DESLIGADA === "1") return permitir();
  if (rotaPublica(pathname, request.method)) return permitir();
  if (sessaoAtual(request)) return permitir();

  if (pathname.startsWith("/api/") || pathname === "/mcp") {
    return NextResponse.json({ error: "Entre com seu e-mail e senha para continuar.", codigo: "sem_sessao" }, { status: 401 });
  }
  if (!existeConta()) return NextResponse.redirect(new URL("/conta", request.url));
  return NextResponse.redirect(new URL(`/entrar?next=${encodeURIComponent(pathname + request.nextUrl.search)}`, request.url));
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
