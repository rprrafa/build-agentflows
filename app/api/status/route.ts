import { chatGPT } from "@/lib/chatgpt";
import { sessaoAtual } from "@/lib/conta";
import { requestApi } from "@/lib/flow-api";
import { currentTenant, tenantId } from "@/lib/tenant-context";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  return requestApi(req, async () => {
    const connected = !!(await chatGPT().account()).account;
    const user = tenantId() ? currentTenant().user : undefined;
    return { ai: connected, demo: !connected, model: "ChatGPT", integrations: { chatgpt: connected },
      usuario: user ? { id: user.id, nome: user.name, email: user.email } : sessaoAtual(req) };
  });
}
