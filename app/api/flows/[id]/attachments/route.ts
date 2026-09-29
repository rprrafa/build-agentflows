import { saveAttachment, uploadForm } from "@/lib/attachment-service";
import { requestApi } from "@/lib/flow-api";
import { FlowError } from "@/lib/flow-store";
export async function POST(req: Request, c: { params: Promise<{ id: string }> }) {
  return requestApi(req, async () => {
    const form = await uploadForm(req);
    const file = form.get("file");
    if (!(file instanceof File) || form.getAll("file").length !== 1) throw new FlowError("Envie um arquivo por vez.");
    return saveAttachment((await c.params).id, file);
  });
}
