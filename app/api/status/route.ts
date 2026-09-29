import { chatGPT } from "@/lib/chatgpt";
import { requestApi } from "@/lib/flow-api";
import { currentTenant } from "@/lib/tenant-context";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  return requestApi(req, async () => {
    const connected = !!(await chatGPT().account()).account;
    const user = currentTenant().user;
    return { ai: connected, demo: !connected, model: "ChatGPT", integrations: { chatgpt: connected },
      usuario: { id: user.id, nome: user.name, email: user.email } };
  });
}
