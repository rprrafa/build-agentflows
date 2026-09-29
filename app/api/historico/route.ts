// Lista genérica dos resultados salvos (todos os tipos), para a tela /historico. Compartilhada:
// copie sem alterar — nenhuma referência ao domínio do app.
import { listar } from "@/lib/historico";

export async function GET() {
  return Response.json({ itens: listar(200) });
}
