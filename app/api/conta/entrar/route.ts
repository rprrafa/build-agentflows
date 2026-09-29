// Entrar com e-mail e senha. Compartilhado: copie sem alterar.
import { entrar, ErroConta, cookieDeSessao } from "@/lib/conta";
import { baseUrl } from "@/lib/setup-comum";
import { saasEnabled } from "@/lib/tenant-context";
import { privateJson } from "@/lib/saas-http";

export async function POST(req: Request) {
  if (saasEnabled()) return privateJson({ error: "Use o login em /api/auth/login." }, { status: 410 });
  const dados = await req.json().catch(() => ({}));
  try {
    const { usuario, token } = entrar({ email: dados.email ?? "", senha: dados.senha ?? "" });
    const seguro = baseUrl(req).startsWith("https");
    return Response.json({ usuario }, { headers: { "Set-Cookie": cookieDeSessao(token, seguro) } });
  } catch (err) {
    if (err instanceof ErroConta) return Response.json({ error: err.message }, { status: err.status });
    console.error("Falha ao entrar:", err);
    return Response.json({ error: "Não foi possível entrar. Tente de novo." }, { status: 500 });
  }
}
