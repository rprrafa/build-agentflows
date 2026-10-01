import { aiProvider, modelProviderId, modelSettings } from "./ai-providers";
import { modelCredentialKey } from "./ai-credentials";
import { runChatCompletion } from "./chat-completion";
import { runOpenRouter } from "./openrouter";
import { runAnthropic } from "./anthropic";

export async function runProviderModel(config: Record<string, string>, options: Omit<Parameters<typeof runChatCompletion>[0], "key" | "url" | "parameters">) {
  const provider = modelProviderId(config.model);
  if (provider === "chatgpt") throw new Error("Selecione um fornecedor de API.");
  const key = modelCredentialKey(provider, config.modelCredentialId);
  const settings = modelSettings(config);
  if (provider === "openrouter") return runOpenRouter({ ...options, apiKey: key, settings });
  const p = aiProvider(provider)!;
  const model = config.model.slice(provider.length + 1);
  if (!model || !p.url) throw new Error("Selecione um modelo de texto válido.");
  if (provider === "anthropic") return runAnthropic({ ...options, model, key, settings });
  if (provider === "openai" && /^(o[1-9]|gpt-[5-9])/.test(model) && settings.temperature !== undefined) throw new Error("Remova a temperatura personalizada deste modelo de raciocínio.");
  return runChatCompletion({ ...options, model, key, url: `${p.url}/chat/completions`, parameters: {
    [provider === "openai" ? "max_completion_tokens" : "max_tokens"]: settings.maxTokens || 4000,
    ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
  } });
}
