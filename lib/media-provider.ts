import { setTimeout as delay } from "node:timers/promises";
import { FlowError } from "./flow-store";
import { mediaModel, type MediaProvider } from "./media-models";
import { knowledgeFetch } from "./knowledge-http";
import { MAX_FILE_BYTES } from "./attachment-types";

export type MediaRequest = { provider: MediaProvider; model: string; requestId: string; status: string };
type Json = Record<string, unknown>;
const origins = { replicate: "https://api.replicate.com", higgsfield: "https://api.higgsfield.ai", muapi: "https://api.muapi.ai" };
const pending = new Set(["starting", "processing", "queued", "pending", "in_progress"]);
const succeeded = new Set(["succeeded", "completed"]);

async function readJson(response: Response): Promise<Json> {
  // Do not relay provider error bodies: they may echo credentials, prompts or signed URLs.
  if (!response.ok) { await response.body?.cancel(); throw new FlowError(`O provedor de imagens respondeu com erro ${response.status}. Confira a chave, o saldo e o modelo.`, 502); }
  const reader = response.body?.getReader();
  if (!reader) throw new FlowError("O provedor de imagens retornou uma resposta vazia.", 502);
  const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1024 * 1024) throw new FlowError("A resposta do provedor excedeu o limite permitido.", 502);
      parts.push(value);
    }
    const data: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return data as Json;
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof FlowError) throw error;
    throw new FlowError("O provedor de imagens retornou uma resposta inválida.", 502);
  } finally { reader.releaseLock(); }
}
export function mediaOutputUrl(value: unknown) {
  try {
    if (typeof value !== "string" || value.length > 8192) throw new Error();
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) throw new Error();
    return url;
  } catch { throw new FlowError("O provedor retornou um endereço de imagem inválido.", 502); }
}
export async function generateMedia(options: {
  model: string; key: string; prompt: string; images?: string[]; signal: AbortSignal;
  onSubmitted: (request: MediaRequest) => Promise<void>;
}, dependencies: { fetch: typeof globalThis.fetch; download: typeof knowledgeFetch; pause: (signal: AbortSignal) => Promise<void> } = {
  fetch: globalThis.fetch,
  download: knowledgeFetch,
  pause: (signal: AbortSignal) => delay(1500, undefined, { signal }),
}) {
  const model = mediaModel(options.model);
  if (!model) throw new FlowError("Modelo de imagens não disponível.");
  if (!options.prompt.trim() || options.prompt.length > 20000) throw new FlowError("A descrição da imagem deve ter entre 1 e 20 mil caracteres.");
  const images = options.images || [];
  if (images.length && !model.inputModalities.includes("image")) throw new FlowError(`${model.name} aceita apenas texto neste catálogo. Use Nano Banana da Replicate para editar imagens.`);
  // Bound inline image data independently of the attachment storage quota.
  if (images.length > 5 || images.some((image) => !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) || images.reduce((total, image) => total + image.length, 0) > 8 * 1024 * 1024)
    throw new FlowError("Use até 5 imagens de referência, com até 6 MB no total, para gerar imagens.");
  const provider = model.provider, base = origins[provider];
  const headers: Record<string, string> = provider === "muapi" ? { "x-api-key": options.key } : { Authorization: `${provider === "replicate" ? "Bearer" : "Key"} ${options.key}` };
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(180000)]);
  const api = async (path: string, body?: unknown, requestSignal = signal) => {
    requestSignal.throwIfAborted();
    let response: Response;
    try {
      response = await dependencies.fetch(base + path, {
        method: body === undefined ? "GET" : "POST", redirect: "error",
        headers: { ...headers, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(provider === "replicate" && path.includes("/models/") ? { "Cancel-After": "3m" } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.any([requestSignal, AbortSignal.timeout(30000)]),
      });
    } catch {
      requestSignal.throwIfAborted();
      throw new FlowError("Não foi possível confirmar a resposta do provedor. Confira a solicitação no painel antes de gerar novamente; ela pode ter sido cobrada.", 502);
    }
    return readJson(response);
  };
  const path = provider === "replicate" ? `/v1/models/${model.path}/predictions` : provider === "muapi" ? `/api/v1/${model.path}` : `/${model.path}`;
  const body = provider === "replicate" ? { input: { prompt: options.prompt, image_input: images, output_format: "png" } }
    : provider === "higgsfield" ? { prompt: options.prompt, batch_size: 1 }
    : { prompt: options.prompt, output_format: "png", resolution: "1k" };
  let requestId = "", terminal = false;
  try {
    // Exactly one submission. A lost response is not permission to generate and charge again.
    let result = await api(path, body);
    const id = provider === "replicate" ? result.id : result.request_id;
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(id)) throw new FlowError("O provedor não retornou uma identificação válida. Confira seu painel antes de gerar novamente.", 502);
    requestId = id;
    await options.onSubmitted({ provider, model: model.id, requestId, status: "submitted" });
    const poll = provider === "replicate" ? `/v1/predictions/${id}` : provider === "higgsfield" ? `/requests/${id}/status` : `/api/v1/predictions/${id}/result`;
    // Ignore provider-supplied status/cancel URLs; authentication only goes to fixed API origins.
    while (true) {
      signal.throwIfAborted();
      const status = String(result.status || "queued");
      if (succeeded.has(status)) { terminal = true; break; }
      if (!pending.has(status)) {
        terminal = true;
        throw new FlowError(["canceled", "cancelled"].includes(status) ? "A geração foi cancelada pelo provedor." : status === "nsfw" ? "O provedor recusou a imagem por sua política de conteúdo." : "O provedor não concluiu a geração da imagem. Consulte a solicitação em seu painel.", 502);
      }
      await dependencies.pause(signal);
      result = await api(poll);
    }
    const outputs = provider === "replicate" ? (typeof result.output === "string" ? [result.output] : result.output)
      : provider === "higgsfield" ? (Array.isArray(result.images) ? result.images.map((image: unknown) => image && typeof image === "object" ? (image as Json).url : null) : null) : result.outputs;
    if (!Array.isArray(outputs) || !outputs.length || outputs.length > 5) throw new FlowError("O provedor não retornou de 1 a 5 imagens válidas.", 502);
    const files: Buffer[] = [];
    let total = 0;
    for (const output of outputs) {
      signal.throwIfAborted();
      const url = mediaOutputUrl(output);
      // Replicate's delivery hosts may require the token. Never attach it to other hosts.
      const authorized = provider === "replicate" && (url.hostname === "replicate.delivery" || url.hostname.endsWith(".replicate.delivery"));
      const bytes = await dependencies.download(url.href, { signal, maxBytes: MAX_FILE_BYTES, ...(authorized ? { headers } : {}) });
      total += bytes.length;
      if (total > 20 * 1024 * 1024) throw new FlowError("As imagens geradas excedem 20 MB.", 413);
      files.push(bytes);
    }
    return files;
  } catch (error) {
    if (requestId && !terminal && provider !== "muapi") {
      const cancel = provider === "replicate" ? `/v1/predictions/${requestId}/cancel` : `/requests/${requestId}/cancel`;
      // Higgsfield can refuse cancellation after execution starts. MuAPI has no documented public cancellation API.
      await dependencies.fetch(base + cancel, { method: "POST", headers, redirect: "error", signal: AbortSignal.timeout(5000) })
        .then((response) => response.body?.cancel()).catch(() => {});
    }
    if (signal.aborted) throw new FlowError("Geração interrompida. A tarefa pode continuar no provedor; confira seu painel antes de repetir.", 409);
    throw error;
  }
}
