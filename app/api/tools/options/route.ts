import { requestApi, body } from "@/lib/flow-api";
import { builtinTools } from "@/lib/tools";
import { withToolCredential } from "@/lib/tool-credential-store";
import { resolveServiceToolkit } from "@/lib/tool-services";
import { composioOptions } from "@/lib/tool-composio";
import { FlowError } from "@/lib/flow-store";
import { validateToolCards } from "@/lib/agent-tools";
export async function POST(req: Request) {
  return requestApi(req, async () => {
    const input = await body(req);
    const card = { id: "options", kind: "tool", target: input.tool, credentialId: input.credentialId || undefined, params: input.params || {} };
    validateToolCards(JSON.stringify([card]));
    const tool = builtinTools().find((item) => item.id === input.tool);
    if (!tool) throw new FlowError("Escolha uma ferramenta válida.");
    return withToolCredential(card.credentialId, tool.credentialProvider, async () => {
      if (tool.name === "composio" && (input.kind === "apps" || input.kind === "accounts")) return composioOptions(input.kind, card.params.app);
      return (await resolveServiceToolkit(tool.name, card.params) || []).map((action) => ({ id: action.name, name: action.name, description: action.description }));
    });
  });
}
