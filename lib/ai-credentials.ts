import { aiProvider, aiCredentialProvider, AI_PROVIDERS, type AiProvider } from "./ai-providers";
import { getConfig, setConfig } from "./store";
import { listToolCredentials, resolveCredentialKey, saveToolCredential } from "./tool-credential-store";
import { FlowError } from "./flow-store";

const defaultKey = (provider: string) => `AI_DEFAULT_${provider.toUpperCase()}_CREDENTIAL`;
export function modelCredentialKey(provider: AiProvider, id?: string) {
  const p = aiProvider(provider)!;
  if (id) return resolveCredentialKey(id, aiCredentialProvider(provider), p.key);
  const legacy = getConfig(p.key);
  if (!legacy) throw new FlowError(`Adicione a chave de ${p.name} em Credenciais e selecione a conexão no bloco.`, 409);
  return legacy;
}
// Idempotent migration: legacy flows and settings keep their existing default key;
// new blocks can select the same connection from the credential manager.
export function importModelCredentials() {
  for (const p of AI_PROVIDERS) {
    if (getConfig(defaultKey(p.id)) || !getConfig(p.key)) continue;
    const name = `${p.name} (conexão existente)`;
    const existing = listToolCredentials(aiCredentialProvider(p.id)).find(c => c.name === name);
    const saved = existing || saveToolCredential({ name, provider: aiCredentialProvider(p.id), fields: { [p.key]: getConfig(p.key) } });
    setConfig(defaultKey(p.id), saved.id);
  }
}
export function saveOpenRouterOAuth(key: string) {
  const existing = listToolCredentials(aiCredentialProvider("openrouter"));
  let name = "OpenRouter OAuth", n = 2;
  while (existing.some(c => c.name === name)) name = `OpenRouter OAuth (${n++})`;
  const saved = saveToolCredential({ name, provider: aiCredentialProvider("openrouter"), fields: { OPENROUTER_API_KEY: key } });
  if (!getConfig(defaultKey("openrouter"))) {
    setConfig(defaultKey("openrouter"), saved.id);
    setConfig("OPENROUTER_API_KEY", key);
  }
  return saved;
}
