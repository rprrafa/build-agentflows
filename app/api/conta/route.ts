// Existência da conta e criação (uma conta por instância). Compartilhado: copie sem alterar.
import { criarConta, entrar, ErroConta, existeConta, discoEfemero, cookieDeSessao } from "@/lib/conta";
import { baseUrl } from "@/lib/setup-comum";
import { saasEnabled } from "@/lib/tenant-context";
import { privateJson } from "@/lib/saas-http";

export async function GET() {
  if (saasEnabled()) return privateJson({ existe: false, discoEfemero: false, saas: true });
  return Response.json({ existe: existeConta(), discoEfemero: discoEfemero() });
}

export async function POST(req: Request) {
  if (saasEnabled()) return privateJson({ error: "Use o cadastro em /api/auth/register." }, { status: 410 });
  const dados = await req.json().catch(() => ({}));
  if (dados.senha !== dados.confirmarSenha) {
    return Response.json({ error: "As senhas não são iguais." }, { status: 400 });
  }
  try {
    criarConta({ nome: dados.nome ?? "", email: dados.email ?? "", senha: dados.senha ?? "" });
    const { usuario, token } = entrar({ email: dados.email ?? "", senha: dados.senha ?? "" });
    const seguro = baseUrl(req).startsWith("https");
    return Response.json({ usuario }, { status: 201, headers: { "Set-Cookie": cookieDeSessao(token, seguro) } });
  } catch (err) {
    if (err instanceof ErroConta) return Response.json({ error: err.message }, { status: err.status });
    console.error("Falha ao criar conta:", err);
    return Response.json({ error: "Não foi possível criar a conta. Tente de novo." }, { status: 500 });
  }
}
