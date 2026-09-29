// Catálogo compartilhado entre a página de credenciais e a base de conhecimento.
import { EMBEDDING_PROVIDERS } from "./knowledge-providers";
import type { IndexConfig } from "./knowledge-types";
export const embeddingCredentialProvider = (
  provider: IndexConfig["embeddings"]["provider"],
) => `embedding_${provider}`;
export const embeddingCredentialKey = (
  provider: IndexConfig["embeddings"]["provider"],
) => `EMBEDDING_${provider.toUpperCase()}_KEY`;
export const embeddingCredentialUrl = (
  provider: IndexConfig["embeddings"]["provider"],
) => `EMBEDDING_${provider.toUpperCase()}_URL`;
export const EMBEDDING_CREDENTIAL_CATALOG = EMBEDDING_PROVIDERS.map((p) => ({
  ...p,
  id: `credential:${p.id}`,
  provider: embeddingCredentialProvider(p.id),
}));
