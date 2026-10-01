import sharp from "sharp";
import { attachmentContext, saveAttachment } from "./attachment-service";
import { modelCredentialKey } from "./ai-credentials";
import { mediaModel, validateMediaConfig } from "./media-models";
import { generateMedia } from "./media-provider";
import { memoryPrompt } from "./flow-memory";
import { FlowError, putRun } from "./flow-service";
import type { Block, Run, Trace } from "./flow-types";

export async function runMedia(n: Block, run: Run, prompt: string, instructions: string, signal: AbortSignal, details: Partial<Trace>, generate = generateMedia) {
  const config = n.data.config;
  validateMediaConfig(config);
  const model = mediaModel(config.model)!;
  const key = modelCredentialKey(model.provider, config.modelCredentialId);
  // Generated files remain private attachments. They are not published as provider URLs.
  const context = await attachmentContext(run.flowId, run.attachments);
  const message = await memoryPrompt(run, config, prompt, async () => { throw new FlowError("Este modelo não resume a memória."); });
  details.input = message;
  details.instructions = instructions;
  let submission: NonNullable<Run["mediaRequests"]>[number] | undefined;
  try {
    const files = await generate({
      model: model.id, key, prompt: [instructions, message, context.text].filter(Boolean).join("\n\n"), images: context.images, signal,
      onSubmitted: async (request) => {
        submission = { ...request, nodeId: n.id, at: new Date().toISOString() };
        (run.mediaRequests ||= []).push(submission);
        await putRun(run);
      },
    });
    const images = [];
    for (const [index, bytes] of files.entries()) {
      signal.throwIfAborted();
      let format: string | undefined;
      try { format = (await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata()).format; } catch { /* validated below */ }
      if (!format || !["png", "jpeg", "webp"].includes(format)) throw new FlowError("O provedor não retornou uma imagem PNG, JPG ou WebP válida.", 502);
      images.push(await saveAttachment(run.flowId, new File([new Uint8Array(bytes)], `imagem-${index + 1}.${format}`, { type: `image/${format}` }), true));
    }
    details.images = images;
    if (submission) submission.status = "saved";
    return images.map((image, index) => `![Imagem gerada ${index + 1}](/api/attachments/${image.id})`).join("\n\n");
  } catch (error) {
    if (submission) submission.status = signal.aborted ? "interrupted" : "failed";
    throw error;
  }
}
