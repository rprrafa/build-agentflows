// "Executar agora" no cartão de /setup: roda uma rotina imediatamente, ignorando o agendamento.
import { executarAgora } from "@/lib/rotinas";
import "@/lib/rotinas-do-app";

export async function POST(_req: Request, { params }: RouteContext<"/api/rotinas/[id]/executar-agora">) {
  const { id } = await params;
  const resultado = await executarAgora(id);
  if (!resultado) return Response.json({ error: "Rotina não encontrada." }, { status: 404 });
  return Response.json(resultado);
}
