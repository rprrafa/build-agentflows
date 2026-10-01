import { listToolCredentials } from "@/lib/tool-credential-store";
import { listModels, openRouterKey } from "@/lib/openrouter";
import { requestApi } from "@/lib/flow-api";
export const dynamic = "force-dynamic";
export async function GET(req?: Request) {
  return requestApi(req, async () => {
    const conectado = !!openRouterKey() || listToolCredentials("ai_openrouter").some(c => c.configured);
    return { conectado, modelos: conectado ? await listModels() : [] };
  });
}
