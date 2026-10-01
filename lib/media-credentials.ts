import { getConfig, mascarar } from "./store";
import { currentTenant } from "./tenant-context";
import { MEDIA_PROVIDERS, type MediaProvider } from "./media-models";
import { FlowError } from "./flow-store";

export function mediaCredentials() {
  currentTenant();
  return MEDIA_PROVIDERS.map((provider) => {
    const value = getConfig(provider.key);
    return { ...provider, conectado: !!value, mascarado: mascarar(value) };
  });
}
export function mediaKey(provider: MediaProvider) {
  currentTenant();
  const metadata = MEDIA_PROVIDERS.find((item) => item.id === provider)!;
  const key = getConfig(metadata.key)?.trim();
  if (!key) throw new FlowError(`Adicione a chave de ${metadata.name} em Credenciais.`, 409);
  return key;
}
