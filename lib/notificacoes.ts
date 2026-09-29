// Canais de notificação (e-mail e Slack) usados pelos formulários e rotinas do app. Copie sem alterar.
import { getConfig } from "./store";
import { contaConectada, enviarPorGmail, enviarPorOutlook, ErroEnvioEmail, provedorDeEnvio } from "./email-envio";

export type Canal = "email" | "slack";

export type Notificacao = {
  canal: Canal;
  /** E-mail do destinatário (canal e-mail) ou canal do Slack para sobrepor o padrão do webhook (opcional). */
  destino?: string;
  titulo: string;
  texto: string;
  link?: string;
};

export async function enviar(n: Notificacao): Promise<{ ok: boolean; mensagem: string }> {
  if (n.canal === "slack") return enviarPorSlack(n);
  if (n.canal === "email") return enviarPorEmail(n);
  return { ok: false, mensagem: "Canal de notificação desconhecido." };
}

/** Traduz uma falha HTTP de um provedor de envio numa mensagem sem código cru nem corpo do provedor (o detalhe vai só para console.error). */
function mensagemFalhaEnvio(servico: string, status: number, corpo: string): string {
  console.error(`Falha ao enviar por ${servico}:`, status, corpo.slice(0, 200));
  if (status === 401 || status === 403) return `${servico} recusou a credencial salva. Confira a chave ou a URL.`;
  if (status === 404) return `${servico} não encontrou o destino configurado. Confira o endereço salvo.`;
  if (status === 429) return `${servico} está limitando o envio agora. Tente de novo em alguns minutos.`;
  return `Não foi possível enviar pelo ${servico} agora. Tente novamente.`;
}

async function enviarPorSlack({ destino, titulo, texto, link }: Notificacao): Promise<{ ok: boolean; mensagem: string }> {
  const webhook = getConfig("NOTIFICACOES_SLACK_WEBHOOK");
  if (!webhook) return { ok: false, mensagem: "Cole a URL do webhook do Slack para enviar por esse canal." };
  const linhas = [`*${titulo}*`, texto, link].filter(Boolean).join("\n");
  const corpo: Record<string, string> = { text: linhas };
  if (destino) corpo.channel = destino;
  let resposta: Response;
  try {
    resposta = await fetch(webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  } catch (err) {
    console.error("Não foi possível conectar ao Slack:", err);
    return { ok: false, mensagem: "Não foi possível conectar ao Slack. Confira o endereço do webhook e tente de novo." };
  }
  if (!resposta.ok) return { ok: false, mensagem: mensagemFalhaEnvio("Slack", resposta.status, await resposta.text().catch(() => "")) };
  return { ok: true, mensagem: "Mensagem enviada no Slack." };
}

async function enviarPorEmail({ destino, titulo, texto, link }: Notificacao): Promise<{ ok: boolean; mensagem: string }> {
  if (!destino) return { ok: false, mensagem: "Informe um e-mail de destino." };
  const html = `<p>${texto.replace(/\n/g, "<br/>")}</p>${link ? `<p><a href="${link}">${link}</a></p>` : ""}`;
  const provedor = provedorDeEnvio();
  if (provedor === "gmail" || provedor === "outlook") return enviarPorCaixaPropria(provedor, destino, titulo, html);
  const chaveResend = getConfig("NOTIFICACOES_RESEND_API_KEY");
  if (chaveResend) return enviarPorResend(chaveResend, destino, titulo, html);
  const host = getConfig("NOTIFICACOES_SMTP_HOST");
  if (host) return enviarPorSmtp(host, destino, titulo, html);
  return { ok: false, mensagem: "Conecte o Gmail ou o Outlook, ou configure o Resend ou o SMTP, para enviar por e-mail." };
}

/** Envia pela caixa própria da pessoa (Gmail ou Outlook, conectada em /setup): o remetente é a conta dela
 * mesma, não um endereço genérico do app. */
async function enviarPorCaixaPropria(provedor: "gmail" | "outlook", destino: string, titulo: string, html: string): Promise<{ ok: boolean; mensagem: string }> {
  const nome = provedor === "gmail" ? "Gmail" : "Outlook";
  try {
    if (provedor === "gmail") await enviarPorGmail(destino, titulo, html);
    else await enviarPorOutlook(destino, titulo, html);
    const conta = contaConectada(provedor);
    return { ok: true, mensagem: `Enviado do seu ${nome}${conta ? ` (${conta})` : ""} para ${destino}.` };
  } catch (err) {
    if (err instanceof ErroEnvioEmail) return { ok: false, mensagem: err.message };
    console.error(`Falha ao enviar pelo ${nome}:`, err);
    return { ok: false, mensagem: `Não foi possível enviar pelo ${nome} agora. Tente novamente.` };
  }
}

async function enviarPorResend(chave: string, destino: string, titulo: string, html: string): Promise<{ ok: boolean; mensagem: string }> {
  let resposta: Response;
  try {
    resposta = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "IA para Executivos <onboarding@resend.dev>", to: [destino], subject: titulo, html }),
    });
  } catch (err) {
    console.error("Não foi possível conectar ao Resend:", err);
    return { ok: false, mensagem: "Não foi possível conectar ao Resend agora. Confira a conexão do servidor e tente de novo." };
  }
  if (!resposta.ok) {
    const corpo = await resposta.text().catch(() => "");
    // Conta gratuita do Resend sem domínio verificado: só envia para o e-mail dono da chave. Diagnóstico
    // pelo texto porque o Resend devolve 403 (o mesmo status de chave recusada) para os dois casos.
    if (resposta.status === 403 && /own email address|verify a domain/i.test(corpo)) {
      console.error("Falha ao enviar por Resend (domínio não verificado):", resposta.status, corpo.slice(0, 200));
      return { ok: false, mensagem: "O Resend só envia para o seu próprio e-mail até você verificar um domínio; use o e-mail da conta ou verifique o domínio em resend.com/domains." };
    }
    return { ok: false, mensagem: mensagemFalhaEnvio("Resend", resposta.status, corpo) };
  }
  return { ok: true, mensagem: `E-mail enviado para ${destino} pelo Resend.` };
}

async function enviarPorSmtp(host: string, destino: string, titulo: string, html: string): Promise<{ ok: boolean; mensagem: string }> {
  const porta = Number(getConfig("NOTIFICACOES_SMTP_PORTA") || "587");
  const usuario = getConfig("NOTIFICACOES_SMTP_USUARIO");
  const senha = getConfig("NOTIFICACOES_SMTP_SENHA");
  const { createTransport } = await import("nodemailer");
  const transportador = createTransport({
    host,
    port: porta,
    secure: porta === 465,
    auth: usuario ? { user: usuario, pass: senha } : undefined,
  });
  try {
    await transportador.sendMail({ from: usuario || host, to: destino, subject: titulo, html });
    return { ok: true, mensagem: `E-mail enviado para ${destino} pelo SMTP.` };
  } catch (err) {
    console.error("Falha ao enviar por SMTP:", err);
    return { ok: false, mensagem: "Não foi possível enviar pelo SMTP agora. Confira o servidor, a porta e as credenciais salvas." };
  }
}
