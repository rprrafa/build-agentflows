import { ligar } from "@/lib/elevenlabs";
import { requestApi, body } from "@/lib/flow-api";
export async function POST(req: Request) {
  return requestApi(req, async () => {
    const b = await body(req);
    return ligar(String(b.telefone || ""), String(b.contexto || ""));
  });
}
