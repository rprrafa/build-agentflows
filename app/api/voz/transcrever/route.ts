import { transcrever } from "@/lib/elevenlabs";
import { FlowError } from "@/lib/flow-store";
import { requestApi } from "@/lib/flow-api";
import { uploadForm } from "@/lib/attachments";
export async function POST(req: Request) {
  return requestApi(req, async () => {
    const form = await uploadForm(req);
    const audio = form?.get("audio");
    if (!(audio instanceof Blob)) throw new FlowError("Envie o áudio gravado.");
    return { texto: await transcrever(audio, req.signal) };
  });
}
