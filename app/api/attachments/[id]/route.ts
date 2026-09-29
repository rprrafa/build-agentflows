import { attachmentBytes, getAttachment } from "@/lib/attachment-service";
import { requestApi } from "@/lib/flow-api";
export async function GET(req: Request, c: { params: Promise<{ id: string }> }) {
  return requestApi(req, async () => {
    const { id } = await c.params;
    const a = await getAttachment(id);
    return new Response(new Uint8Array(await attachmentBytes(id)), { headers: {
      "Content-Type": a.mime,
      "Content-Disposition": `${a.kind === "image" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.name)}`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  });
}
