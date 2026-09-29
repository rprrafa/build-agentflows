// Gatilho externo: um agendador de fora (ex.: cron-job.org) chama esta rota para executar as rotinas
// vencidas quando o plano gratuito hiberna o app e ninguém está com a tela aberta.
import { autenticar, executarVencidas, extrairCodigo } from "@/lib/rotinas";
import "@/lib/rotinas-do-app";

export async function POST(req: Request) {
  const codigo = extrairCodigo(req);
  if (!autenticar(codigo)) {
    return Response.json({ error: "Acesso ausente ou inválido. Gere um código de acesso em /setup." }, { status: 401 });
  }
  const executadas = await executarVencidas();
  return Response.json({ total: executadas.length, executadas });
}
