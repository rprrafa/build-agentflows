// Canal WhatsApp com três provedores e o mesmo contrato: enviar texto, receber texto e testar.
//   Z-API (z-api.io): base https://api.z-api.io/instances/<id>/token/<chave>/, cabeçalho Client-Token;
//     POST send-text {phone, message}; avisos cadastrados por PUT update-webhook-received etc.;
//     aviso recebido: { type: "ReceivedCallback", phone, fromMe, isGroup, text: { message } }.
//   Meta (WhatsApp Cloud): POST graph.facebook.com/v21.0/<numero>/messages; avisos verificados por
//     hub.verify_token e entregues como { entry: [{ changes: [{ value: { messages: [...] } }] }] }.
//   ZapperHub (zapperapi.com, compatível com wuzapi): cabeçalho X-Api-Key; POST /chat/send/text
//     {Phone, Body}; aviso { event: { Info: { Sender, IsFromMe, IsGroup }, Message: {...} } }.
// Os avisos chegam em /webhook/whatsapp?chave=<segredo>, com a chave gerada em lib/conexoes.ts.
import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig, setConfig } from "./store";
import { chaveWebhook, provedorWhatsApp, whatsappConfigurado } from "./conexoes";
import { FlowError } from "./flow-store";
import { jobSignal } from "./saas-job-context";
import { knowledgeFetch, KnowledgeServiceError } from "./knowledge-http";
import type { Resultado } from "./conexoes-teste";
export type Recebida = { id: string; conta?: string; de: string; texto: string; nome?: string; provedor: "zapi" | "meta" | "zapperhub" };
const ZAPI_BASE = "https://api.z-api.io";
export function soDigitos(numero: string) {
  return numero.replace(/\D/g, "");
}
function falha(status: number, detalhe: string): FlowError {
  const t = detalhe.toLowerCase();
  if (status === 401 || status === 403 || /token|unauthorized|forbidden|api key/.test(t))
    return new FlowError("O provedor de WhatsApp recusou as credenciais. Confira em Configurações.", 401);
  if (status === 429) return new FlowError("O provedor está limitando o envio agora. Espere um minuto.", 429);
  if (/not connected|disconnected|restore|não conectado/.test(t))
    return new FlowError("O número ainda não está conectado ao provedor.", 409);
  if (/131047|24 hours/.test(t))
    return new FlowError("A Meta só permite respostas livres até 24 horas depois da última mensagem do cliente.", 409);
  return new FlowError("O WhatsApp não aceitou a mensagem agora. Tente de novo em instantes.", 502);
}
async function chamar(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const signal = jobSignal(20000);
  let texto: string;
  try {
    // Custom provider hosts use pinned DNS and reject private addresses and redirects.
    if (new URL(url).origin !== "https://api.zapperapi.com" && !url.startsWith(ZAPI_BASE + "/") && !url.startsWith("https://graph.facebook.com/")) {
      if (new URL(url).protocol !== "https:") throw new FlowError("Use HTTPS para conectar o WhatsApp.");
      texto = (await knowledgeFetch(url, { method: init.method, headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined, signal, maxBytes: 65536, redirects: false })).toString("utf8");
    } else {
      const r = await fetch(url, { ...init, signal, redirect: "error" });
      const parts: Uint8Array[] = []; let size = 0;
      const reader = r.body?.getReader();
      if (reader) try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 65536) { await reader.cancel(); throw new FlowError("O provedor devolveu uma resposta muito grande.", 502); }
          parts.push(value);
        }
      } finally { reader.releaseLock(); }
      texto = Buffer.concat(parts).toString("utf8");
      if (!r.ok) throw falha(r.status, texto);
    }
  } catch (error) {
    if (error instanceof KnowledgeServiceError) throw falha(error.upstreamStatus, "");
    if (error instanceof FlowError) throw error;
    throw new FlowError("Não foi possível falar com o provedor de WhatsApp agora.", 503);
  }
  try { return texto ? JSON.parse(texto) as Record<string, unknown> : {}; }
  catch { throw new FlowError("O provedor devolveu uma resposta inválida.", 502); }
}

function zapi(caminho: string) {
  const id = getConfig("ZAPI_INSTANCE_ID"),
    token = getConfig("ZAPI_TOKEN"),
    client = getConfig("ZAPI_CLIENT_TOKEN");
  if (!id || !token || !client) throw new FlowError("Conecte o WhatsApp (Z-API) em Configurações.");
  return {
    url: `${ZAPI_BASE}/instances/${encodeURIComponent(id)}/token/${encodeURIComponent(token)}/${caminho}`,
    headers: { "Content-Type": "application/json", "Client-Token": client },
  };
}
function zapperhub(caminho: string) {
  const key = getConfig("ZAPPERHUB_KEY");
  if (!key) throw new FlowError("Conecte o WhatsApp (ZapperHub) em Configurações.");
  const base = (getConfig("ZAPPERHUB_URL") || "https://api.zapperapi.com").replace(/\/+$/, "");
  return { url: `${base}${caminho}`, headers: { "Content-Type": "application/json", "X-Api-Key": key, Token: key } };
}
function meta(caminho: string) {
  const token = getConfig("WHATSAPP_TOKEN"),
    numero = getConfig("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !numero) throw new FlowError("Conecte o WhatsApp (Meta) em Configurações.");
  return {
    url: `https://graph.facebook.com/v21.0/${encodeURIComponent(numero)}${caminho}`,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  };
}
export async function enviarMensagem(para: string, texto: string): Promise<void> {
  const numero = soDigitos(para);
  if (numero.length < 10 || numero.length > 15) throw new FlowError("Informe o número com DDI e DDD, só dígitos.");
  const mensagem = texto.trim().slice(0, 4000);
  if (!mensagem) throw new FlowError("A mensagem está vazia.");
  const p = provedorWhatsApp();
  if (!p || !whatsappConfigurado()) throw new FlowError("Conecte o WhatsApp em Configurações antes de enviar.");
  if (p === "zapi") {
    const { url, headers } = zapi("send-text");
    const d = await chamar(url, { method: "POST", headers, body: JSON.stringify({ phone: numero, message: mensagem }) });
    if (!d.messageId && !d.zaapId && typeof d.error === "string") throw falha(200, d.error);
  } else if (p === "meta") {
    const { url, headers } = meta("/messages");
    await chamar(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ messaging_product: "whatsapp", to: numero, type: "text", text: { body: mensagem } }),
    });
  } else {
    const { url, headers } = zapperhub("/chat/send/text");
    await chamar(url, { method: "POST", headers, body: JSON.stringify({ Phone: numero, Body: mensagem }) });
  }
  setConfig("WHATSAPP_ULTIMO_ENVIO", new Date().toISOString());
}
// Cadastra o endereço de avisos no provedor (Z-API e ZapperHub). Na Meta é colado no painel.
export async function configurarAvisos(urlBase: string): Promise<string | null> {
  const p = provedorWhatsApp();
  if (!whatsappConfigurado()) throw new FlowError("Configure o WhatsApp e aceite os termos em Configurações.");
  const endereco = `${urlBase.replace(/\/+$/, "")}/webhook/whatsapp?chave=${chaveWebhook()}`;
  if (p === "zapi") {
    for (const caminho of ["update-webhook-received", "update-webhook-connected", "update-webhook-disconnected"]) {
      const { url, headers } = zapi(caminho);
      await chamar(url, { method: "PUT", headers, body: JSON.stringify({ value: endereco }) });
    }
    return endereco;
  }
  if (p === "zapperhub") {
    const { url, headers } = zapperhub("/webhook");
    await chamar(url, { method: "POST", headers, body: JSON.stringify({ webhookURL: endereco, webhook: endereco }) });
    return endereco;
  }
  return null;
}
export function assinaturaMetaConfere(raw: string, signature: string | null, secret: string) {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(createHmac("sha256", secret).update(raw).digest(), Buffer.from(signature.slice(7), "hex"));
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const string = (value: unknown) => typeof value === "string" ? value : "";
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
// Return every text in a Meta batch. Status, group and outgoing events do not create jobs.
export function interpretarRecebidos(body: unknown): Recebida[] {
  const b = object(body), result: Recebida[] = [];
  const add = (m: Recebida) => {
    if (!m.texto || !m.de) return;
    if (!m.id || m.id.length > 256 || !/^\d{10,15}$/.test(m.de)) throw new FlowError("Mensagem sem identificador ou remetente válido.");
    if (m.texto.length > 20000) throw new FlowError("Mensagem muito grande.", 413);
    result.push(m);
    if (result.length > 100) throw new FlowError("Lote de mensagens muito grande.", 413);
  };
  if (b.type === "ReceivedCallback") {
    if (!b.fromMe && !b.isGroup && !b.isNewsletter)
      add({ id: string(b.messageId), conta: string(b.instanceId), de: soDigitos(string(b.phone)), texto: string(object(b.text).message), nome: string(b.senderName) || undefined, provedor: "zapi" });
  } else if (Array.isArray(b.entry)) {
    for (const entry of b.entry) for (const change of array(object(entry).changes)) {
      const value = object(object(change).value);
      for (const item of array(value.messages)) {
        const m = object(item);
        if (m.type === "text") add({ id: string(m.id), conta: string(object(value.metadata).phone_number_id), de: soDigitos(string(m.from)), texto: string(object(m.text).body), provedor: "meta" });
      }
    }
  } else {
    const ev = object(b.event ?? b), info = object(ev.Info), msg = object(ev.Message);
    if (!info.IsFromMe && !info.IsGroup)
      add({ id: string(info.ID), de: soDigitos(string(info.Sender).split("@")[0]), texto: string(msg.Conversation) || string(msg.conversation) || string(object(msg.ExtendedTextMessage).Text) || string(object(msg.extendedTextMessage).text), nome: string(info.PushName) || undefined, provedor: "zapperhub" });
  }
  return result;
}
export async function testarWhatsApp(): Promise<Resultado> {
  const p = provedorWhatsApp();
  if (!p || !whatsappConfigurado()) return { ok: false, mensagem: "Escolha o provedor e preencha as credenciais." };
  try {
    if (p === "zapi") {
      const { url, headers } = zapi("status");
      const d = await chamar(url, { headers });
      if (d.connected !== true) return { ok: false, mensagem: "Credenciais aceitas, mas o número ainda não está conectado. Escaneie o QR Code no painel da Z-API." };
      return { ok: true, mensagem: d.smartphoneConnected === false ? "Número conectado; o celular está sem internet agora." : "Número conectado e pronto para receber e enviar." };
    }
    if (p === "meta") {
      const { url, headers } = meta("?fields=display_phone_number,verified_name");
      const d = await chamar(url, { headers });
      if (!d.display_phone_number) return { ok: false, mensagem: "A Meta não reconheceu esse número." };
      return { ok: true, mensagem: `Conectado ao número ${d.display_phone_number} (${d.verified_name || "sem nome verificado"}).` };
    }
    const { url, headers } = zapperhub("/session/status");
    const d = await chamar(url, { headers });
    const dados = (d.data ?? d) as { Connected?: boolean; LoggedIn?: boolean };
    if (dados.Connected === false || dados.LoggedIn === false)
      return { ok: false, mensagem: "Chave aceita, mas o número ainda não está conectado no ZapperHub." };
    return { ok: true, mensagem: "ZapperHub respondeu. Número pronto para receber e enviar." };
  } catch (err) {
    return { ok: false, mensagem: err instanceof Error ? err.message : "O provedor não respondeu." };
  }
}
