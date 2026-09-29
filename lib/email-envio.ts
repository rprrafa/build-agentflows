// Envio de avisos pela própria caixa de e-mail da pessoa (Gmail, escopo gmail.send; ou Outlook/Microsoft
// 365, escopo Mail.Send), como alternativa ao Resend/SMTP genérico de lib/notificacoes.ts. Credenciais do
// app (GOOGLE_CLIENT_ID_APP/GOOGLE_CLIENT_SECRET_APP, MICROSOFT_CLIENT_ID_APP/MICROSOFT_CLIENT_SECRET_APP)
// são da suíte inteira, embutidas na imagem publicada pela equipe técnica (mesmo espírito de
// TRELLO_API_KEY_APP em agente-kanban) — nunca pedidas nem editáveis pelo executivo. O código de renovação
// de acesso da pessoa (GMAIL_REFRESH_TOKEN/OUTLOOK_REFRESH_TOKEN) e a conta conectada (GMAIL_CONTA/
// OUTLOOK_CONTA) são gravados pelos callbacks OAuth em app/api/setup/oauth/{google,microsoft}/callback.
//
// Renovação de token (cache em memória por provedor, rotação do refresh token da Microsoft) reaproveita o
// desenho de custos-ia/lib/email.ts, que lê a caixa; aqui o escopo é só de envio, então não há listagem
// nem leitura de mensagem.
import { getConfig, setConfig } from "./store";
import { tenantId } from "./tenant-context";

export type ProvedorCaixa = "gmail" | "outlook";
export type ProvedorEnvio = ProvedorCaixa | "resend" | "smtp";

/** Erro previsível ao conectar/enviar (conexão expirada, autorização sem o escopo certo, provedor fora do ar), com mensagem pronta para a tela. */
export class ErroEnvioEmail extends Error {}

type Chaves = { refresh: string; conta: string; nome: string };
const CHAVES: Record<ProvedorCaixa, Chaves> = {
  gmail: { refresh: "GMAIL_REFRESH_TOKEN", conta: "GMAIL_CONTA", nome: "Gmail" },
  outlook: { refresh: "OUTLOOK_REFRESH_TOKEN", conta: "OUTLOOK_CONTA", nome: "Outlook" },
};

export type CredenciaisApp = { clientId: string; clientSecret: string };

/** Credenciais OAuth do app (da suíte inteira, embutidas na imagem publicada pela equipe técnica) usadas
 * para trocar o code e renovar o acesso. Nunca vêm de lib/store.ts nem aparecem em /setup. */
export function credenciaisDoApp(provedor: ProvedorCaixa): CredenciaisApp | null {
  const chaveId = provedor === "gmail" ? "GOOGLE_CLIENT_ID_APP" : "MICROSOFT_CLIENT_ID_APP";
  const chaveSecreta = provedor === "gmail" ? "GOOGLE_CLIENT_SECRET_APP" : "MICROSOFT_CLIENT_SECRET_APP";
  const clientId = process.env[chaveId]?.trim();
  const clientSecret = process.env[chaveSecreta]?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function caixaConectada(provedor: ProvedorCaixa): boolean {
  return Boolean(getConfig(CHAVES[provedor].refresh));
}

export function contaConectada(provedor: ProvedorCaixa): string | undefined {
  return getConfig(CHAVES[provedor].conta);
}

/** Provedor efetivo do canal e-mail: caixa própria conectada (Gmail antes de Outlook quando as duas
 * estiverem conectadas) primeiro, depois Resend, depois SMTP. */
export function provedorDeEnvio(): ProvedorEnvio {
  if (caixaConectada("gmail")) return "gmail";
  if (caixaConectada("outlook")) return "outlook";
  if (getConfig("NOTIFICACOES_RESEND_API_KEY")) return "resend";
  return "smtp";
}

// ---------------------------------------------------------------------------------------------
// Access token: renovado pelo código de renovação e guardado só em memória até expirar, um cache por
// provedor. A Microsoft devolve um código de renovação novo a cada renovação (rotação): quando vem, é
// gravado no lugar do antigo (salvo quando o antigo veio do ambiente — aí não dá).
// ---------------------------------------------------------------------------------------------

const TOKEN_URL: Record<ProvedorCaixa, string> = {
  gmail: "https://oauth2.googleapis.com/token",
  outlook: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
};

/** Escopo pedido na autorização do Google: só enviar, nunca ler ou apagar a caixa. */
export const ESCOPO_GMAIL = "https://www.googleapis.com/auth/gmail.send";
/** Escopos pedidos na autorização da Microsoft: enviar, código de renovação e a conta conectada. */
export const ESCOPO_OUTLOOK = "Mail.Send offline_access User.Read";

const ESCOPO: Record<ProvedorCaixa, string> = { gmail: ESCOPO_GMAIL, outlook: ESCOPO_OUTLOOK };

type CacheToken = { token: string; expiraEm: number; refresh: string };
const cache = new Map<string, CacheToken>();
const cacheKey = (provedor: ProvedorCaixa) => `${tenantId() || "legacy"}:${provedor}`;

export function limparCache(provedor?: ProvedorCaixa): void {
  if (provedor) cache.delete(cacheKey(provedor));
  else { cache.delete(cacheKey("gmail")); cache.delete(cacheKey("outlook")); }
}

type RespostaToken = { access_token?: string; expires_in?: number; refresh_token?: string; error?: string; error_description?: string };

async function renovarAccessToken(provedor: ProvedorCaixa, refresh: string): Promise<string> {
  const nome = CHAVES[provedor].nome;
  const credenciais = credenciaisDoApp(provedor);
  if (!credenciais) throw new ErroEnvioEmail(`As credenciais ${provedor === "gmail" ? "do Google" : "da Microsoft"} deste app não estão definidas. Peça à equipe técnica para configurá-las.`);
  const corpo = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh, client_id: credenciais.clientId, client_secret: credenciais.clientSecret });
  if (provedor === "outlook") corpo.set("scope", ESCOPO.outlook);
  const r = await fetch(TOKEN_URL[provedor], { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: corpo.toString(), signal: AbortSignal.timeout(20000), redirect: "error" });
  const dados = (await r.json().catch(() => ({}))) as RespostaToken;
  if (!r.ok || !dados.access_token) {
    console.error(`${nome}: falha ao renovar o acesso`, r.status);
    if (dados.error === "invalid_grant") {
      throw new ErroEnvioEmail(`A conexão com o ${nome} expirou ou foi revogada. Conecte o ${nome} de novo em Configurações.`);
    }
    throw new ErroEnvioEmail(`Não foi possível renovar o acesso ao ${nome} agora. Tente de novo em alguns minutos.`);
  }
  let refreshAtual = refresh;
  if (dados.refresh_token && dados.refresh_token !== refresh && (tenantId() || !process.env[CHAVES[provedor].refresh])) {
    setConfig(CHAVES[provedor].refresh, dados.refresh_token);
    refreshAtual = dados.refresh_token;
  }
  for (const [key, entry] of cache) if (entry.expiraEm <= Date.now()) cache.delete(key);
  const key = cacheKey(provedor);
  cache.delete(key);
  if (cache.size >= 200) cache.delete(cache.keys().next().value!);
  cache.set(key, { token: dados.access_token, expiraEm: Date.now() + Math.max((dados.expires_in ?? 3600) - 60, 60) * 1000, refresh: refreshAtual });
  return dados.access_token;
}

async function obterAccessToken(provedor: ProvedorCaixa, forcarRenovacao = false): Promise<string> {
  const refresh = getConfig(CHAVES[provedor].refresh);
  if (!refresh) throw new ErroEnvioEmail(`O ${CHAVES[provedor].nome} não está conectado. Conecte em Configurações.`);
  const c = cache.get(cacheKey(provedor));
  if (!forcarRenovacao && c && c.refresh === refresh && c.expiraEm > Date.now()) return c.token;
  return renovarAccessToken(provedor, refresh);
}

// ---------------------------------------------------------------------------------------------
// Perfil (conta conectada), usado pelo callback OAuth logo após trocar o code.
// ---------------------------------------------------------------------------------------------

export async function obterPerfilGmail(accessToken: string): Promise<string> {
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new ErroEnvioEmail("O Gmail não informou a conta conectada.");
  const dados = (await r.json()) as { emailAddress?: string };
  return dados.emailAddress || "";
}

export async function obterPerfilOutlook(accessToken: string): Promise<string> {
  const r = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new ErroEnvioEmail("A Microsoft não informou a conta conectada.");
  const dados = (await r.json()) as { mail?: string | null; userPrincipalName?: string };
  return dados.mail || dados.userPrincipalName || "";
}

// ---------------------------------------------------------------------------------------------
// Envio.
// ---------------------------------------------------------------------------------------------

function base64url(texto: string): string {
  return Buffer.from(texto, "utf8").toString("base64url");
}

/** Mensagem RFC 2822 mínima (destino, assunto codificado, corpo em HTML). Sem "From": os dois provedores
 * preenchem o remetente sozinhos com a conta autenticada, que é sempre a da própria pessoa. */
function mensagemMime({ destino, assunto, html }: { destino: string; assunto: string; html: string }): string {
  const linhas = [
    `To: ${destino}`,
    `Subject: =?UTF-8?B?${Buffer.from(assunto, "utf8").toString("base64")}?=`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "",
    html,
  ];
  return linhas.join("\r\n");
}

/** Chama `enviar(token)` com o acesso válido, renovando uma vez em 401. Traduz qualquer outra falha numa
 * frase pronta para a tela (nunca status HTTP cru nem corpo do provedor) — o detalhe vai só para console.error. */
async function enviarComRenovacao(provedor: ProvedorCaixa, enviar: (token: string) => Promise<Response>): Promise<void> {
  const nome = CHAVES[provedor].nome;
  let token = await obterAccessToken(provedor);
  let renovado = false;
  for (;;) {
    const r = await enviar(token);
    if (r.ok || r.status === 202) return;
    if (r.status === 401 && !renovado) {
      renovado = true;
      token = await obterAccessToken(provedor, true);
      continue;
    }
    const corpo = await r.text().catch(() => "");
    console.error(`${nome}: falha ao enviar`, r.status);
    if (r.status === 403 && /insufficientPermissions|insufficient.?scope/i.test(corpo)) {
      throw new ErroEnvioEmail(`A autorização não incluiu o envio; conecte o ${nome} de novo em Configurações.`);
    }
    if (r.status === 401 || r.status === 403) {
      throw new ErroEnvioEmail(`O ${nome} recusou o envio. Desconecte e conecte o ${nome} de novo em Configurações.`);
    }
    throw new ErroEnvioEmail(`Não foi possível enviar pelo ${nome} agora. Tente de novo em alguns minutos.`);
  }
}

export async function enviarPorGmail(destino: string, assunto: string, html: string): Promise<void> {
  const raw = base64url(mensagemMime({ destino, assunto, html }));
  await enviarComRenovacao("gmail", (token) =>
    fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    })
  );
}

export async function enviarPorOutlook(destino: string, assunto: string, html: string): Promise<void> {
  await enviarComRenovacao("outlook", (token) =>
    fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { subject: assunto, body: { contentType: "HTML", content: html }, toRecipients: [{ emailAddress: { address: destino } }] } }),
    })
  );
}

// ---------------------------------------------------------------------------------------------
// Desconexão.
// ---------------------------------------------------------------------------------------------

/** Apaga a conexão neste app e, no Google, pede a revogação do código de renovação (melhor esforço). A
 * Microsoft não tem revogação por chamada: a pessoa remove o app em myaccount.microsoft.com. */
export async function desconectar(provedor: ProvedorCaixa): Promise<void> {
  const chaves = CHAVES[provedor];
  const refresh = getConfig(chaves.refresh);
  limparCache(provedor);
  setConfig(chaves.refresh, null);
  setConfig(chaves.conta, null);
  if (!refresh || (!tenantId() && process.env[chaves.refresh]) || provedor !== "gmail") return;
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refresh)}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  } catch {
    console.error("Não foi possível revogar o acesso ao Gmail no Google");
  }
}
