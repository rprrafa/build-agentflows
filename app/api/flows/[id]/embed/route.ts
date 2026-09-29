import { requestApi, body } from "@/lib/flow-api";
import { appOrigin } from "@/lib/saas-security";
import { embedSettings, hasEmbedKey, issueEmbedTicket, rotateEmbedKey, saveEmbedSettings } from "@/lib/embed-store";
export async function GET(req: Request, c: { params: Promise<{id:string}> }) {
  return requestApi(req, async () => { const { id } = await c.params; return { settings: await embedSettings(id), hasKey: hasEmbedKey(id) }; });
}
export async function PUT(req: Request, c: { params: Promise<{id:string}> }) {
  // saveEmbedSettings validates every setting at runtime before persisting it.
  return requestApi(req, async () => saveEmbedSettings((await c.params).id, await body(req) as Parameters<typeof saveEmbedSettings>[1]));
}
export async function POST(req: Request, c: { params: Promise<{id:string}> }) {
  return requestApi(req, async () => {
    const { id } = await c.params, b = await body(req);
    if (b.action === "preview") {
      if ((await embedSettings(id)).enabled && !hasEmbedKey(id)) await rotateEmbedKey(id);
      const origin = appOrigin();
      return issueEmbedTicket(id, "admin-preview", origin, true);
    }
    return { key: await rotateEmbedKey(id) };
  });
}
