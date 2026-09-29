import { api, body } from "@/lib/flow-api";
import { embedSettings, hasEmbedKey, issueEmbedTicket, rotateEmbedKey, saveEmbedSettings } from "@/lib/embed-store";
export async function GET(_: Request, c: { params: Promise<{id:string}> }) {
  return api(async () => { const { id } = await c.params; return { settings: embedSettings(id), hasKey: hasEmbedKey(id) }; });
}
export async function PUT(req: Request, c: { params: Promise<{id:string}> }) {
  return api(async () => saveEmbedSettings((await c.params).id, await body(req)));
}
export async function POST(req: Request, c: { params: Promise<{id:string}> }) {
  return api(async () => {
    const { id } = await c.params, b = await body(req);
    if (b.action === "preview") {
      if (embedSettings(id).enabled && !hasEmbedKey(id)) rotateEmbedKey(id);
      const origin = req.headers.get("origin") || new URL(req.url).origin;
      return issueEmbedTicket(id, "admin-preview", origin);
    }
    return { key: rotateEmbedKey(id) };
  });
}
