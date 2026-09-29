import { listTools } from "@/lib/tools";
import { salvarCampos } from "@/lib/conexoes";
import { TOOL_CREDENTIAL_KEYS } from "@/lib/tool-credentials";
import { FlowError } from "@/lib/flow-store";
import { requestApi, body } from "@/lib/flow-api";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  return requestApi(req, () => listTools(new URL(req.url).searchParams.get("server") || undefined));
}
// Credenciais das ferramentas prontas (ex.: chave da Tavily), salvas a partir do diálogo do Agente.
export async function PUT(req: Request) {
  return requestApi(req, async () => {
    const campos = (await body(req)).campos;
    if (!campos || typeof campos !== "object" || Array.isArray(campos) || Object.keys(campos).some((k) => !TOOL_CREDENTIAL_KEYS.includes(k))) throw new FlowError("Escolha uma credencial de ferramenta válida.");
    salvarCampos(campos);
    return listTools("interno");
  });
}
