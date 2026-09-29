import { FERRAMENTAS, NOME_SERVIDOR } from "@/lib/ferramentas";
import { autenticar, extrairCodigo, limiteExcedido, tratarRequisicaoRpc } from "@/lib/mcp";

export async function POST(req: Request) {
  const codigo = extrairCodigo(req);
  if (!autenticar(codigo)) {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Acesso ausente ou inválido. Gere um código de acesso em /setup." } },
      { status: 401 }
    );
  }
  if (limiteExcedido(codigo as string)) {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32002, message: "Limite de 60 chamadas por minuto atingido. Tente de novo em instantes." } },
      { status: 429 }
    );
  }
  const corpo = await req.json().catch(() => null);
  if (!corpo || corpo.jsonrpc !== "2.0" || typeof corpo.method !== "string") {
    return Response.json({ jsonrpc: "2.0", id: corpo?.id ?? null, error: { code: -32600, message: "Requisição JSON-RPC inválida." } }, { status: 400 });
  }
  const resposta = await tratarRequisicaoRpc(corpo, FERRAMENTAS, NOME_SERVIDOR);
  return Response.json(resposta);
}

export async function GET() {
  return new Response("Método não permitido. Use POST com uma requisição JSON-RPC 2.0.", { status: 405 });
}
