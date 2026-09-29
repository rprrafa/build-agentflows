// Gera, mostra o estado e revoga o código de acesso usado pelo endpoint MCP (app/mcp/route.ts).
import { codigoAtivo, codigoMascarado, gerarCodigo, revogarCodigo } from "@/lib/mcp";

export async function GET() {
  return Response.json({ ativo: Boolean(codigoAtivo()), mascarado: codigoMascarado() });
}

export async function POST() {
  const codigo = gerarCodigo();
  return Response.json({ codigo });
}

export async function DELETE() {
  revogarCodigo();
  return Response.json({ ok: true });
}
