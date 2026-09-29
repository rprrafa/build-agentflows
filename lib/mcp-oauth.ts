// Autorização OAuth 2.0 (Authorization Code + PKCE) para servidores MCP remotos que exigem login,
// para a pessoa clicar em "Autorizar" em vez de colar código manualmente. Descobre os endpoints do
// provedor (bem conhecidos, com fallback), faz registro dinâmico de cliente quando o provedor
// oferece, e guarda o resultado com o mesmo prefixo de chave já usado pelo campo manual da
// integração (ex.: MCP_TAREFAS). Compartilhado: nasce aqui e é copiado sem alterar para os outros
// 9 apps; quem usa é lib/setup-comum.ts (integracaoMCP()) e as rotas em
// app/api/setup/oauth/mcp/[prefixo].
import { createHash, randomBytes } from "node:crypto";
import { getConfig, setConfig } from "./store";

type MetadadosOAuth = {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
};

async function buscarJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000), redirect: "error" });
    if (!r.ok) return null;
    return (await r.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Descobre os endpoints OAuth de um servidor MCP a partir do seu endereço. */
export async function descobrirMetadados(urlServidor: string): Promise<MetadadosOAuth> {
  const raiz = new URL(urlServidor).origin;
  let servidorAutorizacao = raiz;

  const recurso = await buscarJson(`${raiz}/.well-known/oauth-protected-resource`);
  const primeiroServidor = Array.isArray(recurso?.authorization_servers) ? (recurso!.authorization_servers as unknown[])[0] : undefined;
  if (typeof primeiroServidor === "string" && primeiroServidor) servidorAutorizacao = primeiroServidor;

  const metadados = await buscarJson(`${servidorAutorizacao}/.well-known/oauth-authorization-server`);
  return {
    authorization_endpoint: typeof metadados?.authorization_endpoint === "string" ? metadados.authorization_endpoint : `${servidorAutorizacao}/authorize`,
    token_endpoint: typeof metadados?.token_endpoint === "string" ? metadados.token_endpoint : `${servidorAutorizacao}/token`,
    registration_endpoint: typeof metadados?.registration_endpoint === "string" ? metadados.registration_endpoint : undefined,
  };
}

/** Registro dinâmico de cliente (RFC 7591). Reaproveita o client_id já salvo quando existir. */
async function obterClientId(prefixo: string, metadados: MetadadosOAuth, redirectUri: string): Promise<string | undefined> {
  const salvo = getConfig(`${prefixo}_CLIENT_ID`);
  if (salvo) return salvo;
  if (!metadados.registration_endpoint) return undefined;
  try {
    const resposta = await fetch(metadados.registration_endpoint, {
      method: "POST",
      signal: AbortSignal.timeout(15000), redirect: "error",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "IA para Executivos",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    });
    if (!resposta.ok) return undefined;
    const dados = (await resposta.json()) as { client_id?: string };
    if (!dados.client_id) return undefined;
    setConfig(`${prefixo}_CLIENT_ID`, dados.client_id);
    return dados.client_id;
  } catch {
    return undefined;
  }
}

function gravarToken(prefixo: string, dados: { access_token?: string; refresh_token?: string; expires_in?: number }): void {
  setConfig(`${prefixo}_CODIGO`, dados.access_token);
  if (dados.refresh_token) setConfig(`${prefixo}_REFRESH`, dados.refresh_token);
  setConfig(`${prefixo}_EXPIRA`, dados.expires_in ? String(Date.now() + dados.expires_in * 1000) : null);
}

export type InicioAutorizacao = { destino: string; verifier: string };

/** Monta a URL de autorização (com PKCE) e salva o endereço do servidor para as próximas etapas. */
export async function iniciarAutorizacao(prefixo: string, urlServidor: string, redirectUri: string): Promise<InicioAutorizacao> {
  const metadados = await descobrirMetadados(urlServidor);
  const clientId = await obterClientId(prefixo, metadados, redirectUri);
  setConfig(`${prefixo}_URL`, urlServidor);

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const destino = new URL(metadados.authorization_endpoint);
  destino.searchParams.set("response_type", "code");
  destino.searchParams.set("redirect_uri", redirectUri);
  destino.searchParams.set("code_challenge", challenge);
  destino.searchParams.set("code_challenge_method", "S256");
  destino.searchParams.set("resource", new URL(urlServidor).origin);
  if (clientId) destino.searchParams.set("client_id", clientId);
  return { destino: destino.toString(), verifier };
}

/** Troca o code (recebido no retorno) pelo token no servidor e grava o resultado. */
export async function trocarCode(prefixo: string, code: string, verifier: string, redirectUri: string): Promise<void> {
  const urlServidor = getConfig(`${prefixo}_URL`);
  if (!urlServidor) throw new Error("A conexão expirou. Tente autorizar de novo.");
  const metadados = await descobrirMetadados(urlServidor);
  const clientId = getConfig(`${prefixo}_CLIENT_ID`);
  const corpo = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier });
  if (clientId) corpo.set("client_id", clientId);

  const resposta = await fetch(metadados.token_endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(15000), redirect: "error",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: corpo.toString(),
  });
  if (!resposta.ok) {
    await resposta.body?.cancel();
    throw new Error("O servidor não concluiu a conexão. Tente autorizar de novo; se repetir, cole o código de acesso manualmente em Opções avançadas.");
  }
  const dados = (await resposta.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!dados.access_token) throw new Error("O servidor não devolveu um código de acesso.");
  gravarToken(prefixo, dados);
}

async function renovar(prefixo: string): Promise<string | undefined> {
  const urlServidor = getConfig(`${prefixo}_URL`);
  const refresh = getConfig(`${prefixo}_REFRESH`);
  if (!urlServidor || !refresh) return undefined;
  try {
    const metadados = await descobrirMetadados(urlServidor);
    const clientId = getConfig(`${prefixo}_CLIENT_ID`);
    const corpo = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh });
    if (clientId) corpo.set("client_id", clientId);
    const resposta = await fetch(metadados.token_endpoint, {
      method: "POST",
      signal: AbortSignal.timeout(15000), redirect: "error",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: corpo.toString(),
    });
    if (!resposta.ok) return undefined;
    const dados = (await resposta.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!dados.access_token) return undefined;
    gravarToken(prefixo, { ...dados, refresh_token: dados.refresh_token ?? refresh });
    return dados.access_token;
  } catch {
    return undefined;
  }
}

/** {url, token} prontos para lib/mcp-cliente.ts, renovando o token quando faltar menos de 60s para expirar. */
export async function conexaoAutorizada(prefixo: string): Promise<{ url: string; token: string } | undefined> {
  const url = getConfig(`${prefixo}_URL`);
  let token = getConfig(`${prefixo}_CODIGO`);
  if (!url || !token) return undefined;
  const expira = Number(getConfig(`${prefixo}_EXPIRA`) || 0);
  if (expira && expira - Date.now() < 60_000) {
    token = (await renovar(prefixo)) ?? token;
  }
  return { url, token };
}

/** Revoga a conexão: apaga o código de acesso, o refresh token e a validade salvos. */
export function desconectar(prefixo: string): void {
  setConfig(`${prefixo}_CODIGO`, null);
  setConfig(`${prefixo}_REFRESH`, null);
  setConfig(`${prefixo}_EXPIRA`, null);
}
