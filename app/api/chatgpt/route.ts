import { chatGPT } from "@/lib/chatgpt";
import { requestApi, body } from "@/lib/flow-api";
export const dynamic = "force-dynamic";
export async function GET(req?: Request) {
  return requestApi(req, async () => {
    const status = await chatGPT().account();
    return {
      ...status,
      models: status.account ? await chatGPT().models() : [],
    };
  });
}
export async function POST(req?: Request) {
  return requestApi(req, () => chatGPT().beginLogin());
}
export async function DELETE(req: Request) {
  return requestApi(req, async () => {
    const b = await body(req);
    if (b.cancel) await chatGPT().cancelLogin();
    else await chatGPT().logout();
    return { ok: true };
  });
}
