import { EMBEDDING_PROVIDERS } from "./knowledge-providers";
import { embeddingCredentialKey, embeddingCredentialUrl, embeddingCredentialProvider } from "./embedding-credentials";
// Credenciais das ferramentas prontas (mesmos serviços do catálogo de ferramentas do Flowise).
// Ficam no banco cifrado; a tela do Agente pede só o que a ferramenta escolhida precisa.
export type Credential = { chave: string; rotulo: string; ajuda?: string; link?: string; secret?: boolean; optional?: boolean; definido?: boolean; valor?: string; defaultValue?: string };
const oauth = (provider: string, label: string, link: string): Credential[] => [
  { chave: `TOOL_${provider}_TOKEN`, rotulo: `Token de acesso ${label}`, secret: true, link, ajuda: "Use as permissões dos serviços que deseja disponibilizar aos agentes." },
  { chave: `TOOL_${provider}_REFRESH_TOKEN`, rotulo: "Token de renovação (opcional)", secret: true, optional: true },
  { chave: `TOOL_${provider}_CLIENT_ID`, rotulo: "Identificador do aplicativo (para renovar)", optional: true },
  { chave: `TOOL_${provider}_CLIENT_SECRET`, rotulo: "Segredo do aplicativo (para renovar)", secret: true, optional: true },
];
export const TOOL_CREDENTIALS: Record<string, Credential[]> = {
  ...Object.fromEntries(EMBEDDING_PROVIDERS.map(p => [embeddingCredentialProvider(p.id), [
    { chave: embeddingCredentialKey(p.id), rotulo: "Chave de acesso", secret: true, optional: p.id === "ollama", link: p.id === "openai" ? "https://platform.openai.com/api-keys" : p.id === "gemini" ? "https://aistudio.google.com/apikey" : p.id === "voyage" ? "https://dash.voyageai.com/" : undefined },
    { chave: embeddingCredentialUrl(p.id), rotulo: "Endereço do serviço", defaultValue: p.url },
  ]])) ,
  knowledge_postgres: [{ chave: "KNOWLEDGE_POSTGRES_USER", rotulo: "Usuário", secret: true }, { chave: "KNOWLEDGE_POSTGRES_PASSWORD", rotulo: "Senha", secret: true }],
  github_mcp: [{ chave: "TOOL_GITHUB_TOKEN", rotulo: "Token do Github", secret: true, link: "https://github.com/settings/tokens" }],
  postgres_mcp: [{ chave: "TOOL_POSTGRES_URL", rotulo: "URL de conexão PostgreSQL", secret: true }],
  custom_mcp: [{ chave: "TOOL_CUSTOM_MCP_URL", rotulo: "URL do servidor MCP" }, { chave: "TOOL_CUSTOM_MCP_TOKEN", rotulo: "Token de acesso", secret: true, optional: true }],
  composio: [{ chave: "TOOL_COMPOSIO_KEY", rotulo: "Chave da Composio", secret: true, link: "https://platform.composio.dev/" }],
  google_workspace: oauth("GOOGLE", "Google", "https://developers.google.com/oauthplayground/"),
  microsoft: [...oauth("MICROSOFT", "Microsoft", "https://developer.microsoft.com/graph/graph-explorer"), { chave: "TOOL_MICROSOFT_TENANT", rotulo: "Diretório da organização (opcional)", optional: true }],
  e2b: [{ chave: "TOOL_E2B_KEY", rotulo: "Chave da E2B", secret: true, link: "https://e2b.dev/dashboard" }],
  browserless: [{ chave: "TOOL_BROWSERLESS_TOKEN", rotulo: "Token do Browserless", secret: true, link: "https://www.browserless.io/" }],
  slack: [{ chave: "TOOL_SLACK_TOKEN", rotulo: "Token OAuth do Slack MCP", secret: true, ajuda: "Autorize seu aplicativo Slack com acesso ao servidor MCP.", link: "https://docs.slack.dev/ai/slack-mcp-server/" }],
  openapi: [{ chave: "TOOL_OPENAPI_URL", rotulo: "Endereço da especificação OpenAPI 3 (JSON)" }, { chave: "TOOL_OPENAPI_TOKEN", rotulo: "Credencial Bearer (opcional)", secret: true, optional: true }],
  tavily: [{ chave: "TOOL_TAVILY_KEY", rotulo: "Chave da Tavily", link: "https://app.tavily.com/home", secret: true }],
  searchapi: [{ chave: "TOOL_SEARCHAPI_KEY", rotulo: "Chave da SearchApi", link: "https://www.searchapi.io/", secret: true }],
  exa: [{ chave: "TOOL_EXA_KEY", rotulo: "Chave da Exa", link: "https://dashboard.exa.ai/", secret: true }],
  serper: [{ chave: "TOOL_SERPER_KEY", rotulo: "Chave da Serper", link: "https://serper.dev/", secret: true }],
  serpapi: [{ chave: "TOOL_SERPAPI_KEY", rotulo: "Chave da SerpApi", link: "https://serpapi.com/", secret: true }],
  brave: [{ chave: "TOOL_BRAVE_KEY", rotulo: "Chave da Brave Search", link: "https://brave.com/search/api/", secret: true }],
  google: [
    { chave: "TOOL_GOOGLE_KEY", rotulo: "Chave do Google Custom Search", link: "https://developers.google.com/custom-search/v1/overview", secret: true },
    { chave: "TOOL_GOOGLE_CX", rotulo: "Identificador do mecanismo (cx)", ajuda: "Criado em programmablesearchengine.google.com." },
  ],
  wolfram: [{ chave: "TOOL_WOLFRAM_APPID", rotulo: "AppID do Wolfram Alpha", link: "https://developer.wolframalpha.com/", secret: true }],
  searxng: [{ chave: "TOOL_SEARXNG_URL", rotulo: "Endereço da sua instância SearXNG", ajuda: "Ex.: https://busca.suaempresa.com (com JSON habilitado)." }],
};
export const TOOL_CREDENTIAL_KEYS = Object.values(TOOL_CREDENTIALS).flatMap((l) => l.map((c) => c.chave));
export const TOOL_CREDENTIAL_LABELS: Record<string, string> = {
  ...Object.fromEntries(EMBEDDING_PROVIDERS.map(p => [embeddingCredentialProvider(p.id), p.name])),
  knowledge_postgres: "Postgres · Base de Conhecimento",
  github_mcp: "Github MCP", postgres_mcp: "Postgres MCP", custom_mcp: "Custom MCP", composio: "Composio",
  google_workspace: "Google Workspace", microsoft: "Microsoft 365", e2b: "E2B", browserless: "Browserless", slack: "Slack", openapi: "API da empresa",
  tavily: "Tavily", searchapi: "SearchAPI", exa: "Exa", serper: "Serper", serpapi: "SerpAPI", brave: "Brave Search", google: "Google Custom Search", wolfram: "Wolfram Alpha", searxng: "SearXNG",
};
