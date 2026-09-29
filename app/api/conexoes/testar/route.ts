import { testarConexao } from "@/lib/conexoes-teste";
import { requestApi, body } from "@/lib/flow-api";
export async function POST(req: Request) {
  return requestApi(req, async () => testarConexao(String((await body(req)).id || "")));
}
