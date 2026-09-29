import { codigoAtivo, codigoMascarado, gerarCodigo, revogarCodigo } from "@/lib/mcp";
import { requestApi } from "@/lib/flow-api";
export async function GET(req: Request) {
  return requestApi(req, () => ({ ativo: Boolean(codigoAtivo()), mascarado: codigoMascarado() }));
}
export async function POST(req: Request) {
  return requestApi(req, () => ({ codigo: gerarCodigo() }));
}
export async function DELETE(req: Request) {
  return requestApi(req, () => { revogarCodigo(); return { ok: true }; });
}
