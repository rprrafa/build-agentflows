import { adicionarServidorMCP, statusConexoes } from "@/lib/conexoes";
import { requestApi, body } from "@/lib/flow-api";
export async function GET(req?: Request) {
  return requestApi(req, async () => (await statusConexoes("")).mcp);
}
export async function POST(req: Request) {
  return requestApi(req, async () => {
    const b = await body(req);
    return adicionarServidorMCP(b.nome, b.url, b.codigo);
  });
}
