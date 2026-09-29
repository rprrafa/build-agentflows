import { autenticar, extrairCodigo, limiteExcedido } from "@/lib/mcp";
import { startRun } from "@/lib/flow-runtime";
import { api, body } from "@/lib/flow-api";
export async function POST(
  req: Request,
  c: { params: Promise<{ id: string }> },
) {
  const code = extrairCodigo(req);
  if (!autenticar(code))
    return Response.json(
      { error: "Código de acesso inválido." },
      { status: 401 },
    );
  if (limiteExcedido(code!))
    return Response.json(
      { error: "Aguarde um minuto antes de tentar novamente." },
      { status: 429 },
    );
  return api(async () => {
    const b = await body(req);
    const r = await startRun((await c.params).id, b.input, true);
    return {
      id: r.id,
      status: r.status,
      output: r.output,
      error: r.error,
      demo: r.demo,
      version: r.version,
    };
  });
}
