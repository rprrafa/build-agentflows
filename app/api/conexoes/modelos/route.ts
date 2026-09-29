import { listModels, openRouterKey } from "@/lib/openrouter";
import { requestApi } from "@/lib/flow-api";
export const dynamic = "force-dynamic";
export async function GET(req?: Request) {
  return requestApi(req, async () => ({
    conectado: !!openRouterKey(),
    modelos: openRouterKey() ? await listModels() : [],
  }));
}
