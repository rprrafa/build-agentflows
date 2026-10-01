import { requestApi } from "@/lib/flow-api";
import { aiProvider } from "@/lib/ai-providers";
import { providerModels } from "@/lib/ai-models";
import { FlowError } from "@/lib/flow-store";

export async function GET(req: Request) {
  return requestApi(req, async () => {
    const query = new URL(req.url).searchParams;
    const provider = aiProvider(query.get("provider") || "");
    if (!provider) throw new FlowError("Escolha um fornecedor válido.");
    return { models: await providerModels(provider.id, query.get("credentialId") || undefined) };
  });
}
