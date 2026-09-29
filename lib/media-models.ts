import { memorySettings } from "./memory-settings";
import { knowledgeSettings } from "./knowledge-settings";

// Shared, public metadata only. API credentials never belong in the model catalogue.
export const MEDIA_PROVIDERS = [
  { id: "replicate", name: "Replicate", key: "REPLICATE_API_TOKEN" },
  { id: "higgsfield", name: "Higgsfield", key: "HIGGSFIELD_API_KEY" },
  { id: "muapi", name: "MuAPI", key: "MUAPI_API_KEY" },
] as const;
export type MediaProvider = typeof MEDIA_PROVIDERS[number]["id"];
export type MediaModel = { id: string; name: string; provider: MediaProvider; path: string; inputModalities: string[] };
export const MEDIA_MODELS: MediaModel[] = [
  { id: "replicate:google/nano-banana", name: "Nano Banana", provider: "replicate", path: "google/nano-banana", inputModalities: ["text", "image"] },
  { id: "higgsfield:higgsfield-ai/soul/v2/standard", name: "Soul 2", provider: "higgsfield", path: "higgsfield-ai/soul/v2/standard", inputModalities: ["text"] },
  { id: "muapi:nano-banana-2", name: "Nano Banana 2", provider: "muapi", path: "nano-banana-2", inputModalities: ["text"] },
];
export const isMediaModel = (id?: string) => MEDIA_PROVIDERS.some((provider) => id?.startsWith(provider.id + ":"));
export const mediaModel = (id?: string) => MEDIA_MODELS.find((model) => model.id === id);
export function validateMediaConfig(config: Record<string, string>) {
  if (!isMediaModel(config.model)) return;
  if (!mediaModel(config.model)) throw new Error("Escolha um modelo de imagens disponível no catálogo.");
  if (config.tools?.trim() || knowledgeSettings(config).bases.length)
    throw new Error("Geradores de imagens não consultam ferramentas ou bases. Use um bloco de texto anterior para preparar a descrição da imagem.");
  const memory = memorySettings(config);
  if (memory.enabled && ["conversationSummary", "conversationSummaryBuffer"].includes(memory.type))
    throw new Error("Geradores de imagens não resumem a memória. Escolha Todas as mensagens, Últimas mensagens ou desative a memória.");
}
