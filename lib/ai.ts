// Camada única de acesso à IA via OpenRouter (API compatível com OpenAI).
// Sem OPENROUTER_API_KEY o app entra em modo demonstração (ver lib/demo.ts).

import { getConfig } from "./store";
import { MODELO_AUTOMATICO, MODELOS_VISAO } from "./modelos";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Modelo padrão gratuito. Troque por OPENROUTER_MODEL (ex.: "anthropic/claude-sonnet-4.5") quando quiser um modelo pago.
export const DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
// Se o modelo principal falhar (fila cheia, indisponível), o OpenRouter tenta estes em ordem.
export const FALLBACK_MODELS = ["google/gemma-4-31b-it:free", "nvidia/nemotron-3-ultra-550b-a55b:free"];

function apiKey(): string | undefined {
  return getConfig("OPENROUTER_API_KEY");
}

export type CodigoErroIA =
  | "chave_ausente"
  | "chave_invalida"
  | "sem_credito"
  | "limite_diario"
  | "fila_cheia"
  | "modelo_indisponivel"
  | "entrada_recusada"
  | "sem_visao"
  | "provedor_fora"
  | "rede"
  | "resposta_vazia"
  | "resposta_invalida";

/** Erro da camada de IA com o suficiente para a tela explicar o que houve e oferecer uma ação (ver components/ui.tsx: ErrorBox). */
export class ErroIA extends Error {
  codigo: CodigoErroIA;
  status: number;
  acao?: { rotulo: string; url: string };

  constructor(codigo: CodigoErroIA, mensagem: string, status: number, acao?: { rotulo: string; url: string }) {
    super(mensagem);
    this.name = "ErroIA";
    this.codigo = codigo;
    this.status = status;
    this.acao = acao;
  }
}

const ACAO_CONECTAR_IA = { rotulo: "Conectar a IA", url: "/setup#openrouter" };
const ACAO_TROCAR_MODELO = { rotulo: "Trocar o modelo", url: "/setup#openrouter" };
const ACAO_ADICIONAR_CREDITOS = { rotulo: "Adicionar créditos", url: "https://openrouter.ai/settings/credits" };

/** Único ponto que traduz uma resposta HTTP não-ok do OpenRouter (ou uma falha de rede) em ErroIA. O detalhe técnico do provedor nunca chega à tela: só ao console.error. Exportada só para o caso de demonstração local (?erro=<código> em dev) montar o mesmo ErroIA que uma falha real geraria. */
export function interpretarFalha(res: Response, detalheBruto: string): ErroIA {
  console.error("Falha na chamada à IA:", res.status, detalheBruto.slice(0, 200));

  if (res.status === 401) {
    return new ErroIA("chave_invalida", "A chave da IA foi recusada. Conecte de novo em Configurações.", 401, ACAO_CONECTAR_IA);
  }
  if (res.status === 402) {
    return new ErroIA(
      "sem_credito",
      "Sua conta no OpenRouter está sem crédito para este modelo. Troque para um modelo gratuito ou adicione créditos.",
      402,
      ACAO_ADICIONAR_CREDITOS
    );
  }
  if (res.status === 429) {
    if (/free-models-per-day|daily/i.test(detalheBruto)) {
      return new ErroIA(
        "limite_diario",
        "Você atingiu o limite diário dos modelos gratuitos. Volte amanhã, troque o modelo ou adicione US$ 10 de crédito no OpenRouter para ampliar o limite.",
        429
      );
    }
    return new ErroIA("fila_cheia", "O modelo gratuito está com fila cheia agora. Tente de novo em alguns segundos ou troque de modelo em Configurações.", 429);
  }
  if (res.status === 404 || /No endpoints found|not a valid model/i.test(detalheBruto)) {
    return new ErroIA("modelo_indisponivel", "O modelo escolhido não está disponível agora. Escolha outro em Configurações.", 404, ACAO_TROCAR_MODELO);
  }
  if (res.status === 400 && /context length|too long/i.test(detalheBruto)) {
    return new ErroIA(
      "entrada_recusada",
      "O texto enviado é maior do que este modelo aceita. Reduza o texto ou escolha um modelo com mais capacidade.",
      400
    );
  }
  if (res.status === 400 && /image|modalit/i.test(detalheBruto)) {
    return new ErroIA("sem_visao", "O modelo configurado não lê imagens.", 400);
  }
  return new ErroIA("provedor_fora", "O serviço de IA está instável neste momento. Tente de novo em um minuto.", 502);
}

/** Toda rota usa isto no catch em vez de montar a resposta de erro de IA à mão. */
export function respostaErro(err: unknown): Response {
  if (err instanceof ErroIA) {
    return Response.json({ error: err.message, codigo: err.codigo, acao: err.acao }, { status: err.status });
  }
  console.error(err);
  const mensagem = err instanceof Error ? err.message : "Não foi possível completar a operação agora. Tente novamente.";
  return Response.json({ error: mensagem }, { status: 500 });
}

async function chamarOpenRouter(body: Record<string, unknown>): Promise<Response> {
  if (!apiKey()) {
    throw new ErroIA("chave_ausente", "Nenhuma chave da IA foi configurada. Conecte em Configurações.", 401, ACAO_CONECTAR_IA);
  }
  try {
    return await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
        "HTTP-Referer": getConfig("APP_URL") || "http://localhost:3000",
        "X-Title": getConfig("APP_NAME") || "IA para Executivos",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error("Falha de rede ao chamar a IA:", err);
    throw new ErroIA("rede", "Não foi possível falar com o serviço de IA. Confira a conexão do servidor e tente de novo.", 503);
  }
}

export function aiEnabled(): boolean {
  return Boolean(apiKey());
}

/** As tarefas que podem usar modelos diferentes. "padrao" é tudo o que o app gera no dia a dia;
 * "avaliacao" é o que julga um trabalho e vira nota — vale pagar um modelo mais capaz só nela. */
export type TarefaIA = "padrao" | "avaliacao";

/** Modelo escolhido à mão em /setup, ou nada quando o campo está em "Automático". */
function escolhido(chave: string): string | undefined {
  const valor = getConfig(chave);
  return valor && valor !== MODELO_AUTOMATICO ? valor : undefined;
}

/** Modelo da tarefa. `avaliacao` cai para o modelo da tarefa padrão quando ninguém escolheu um
 * específico — mesmo desenho de visionModelName()/OPENROUTER_MODEL_VISAO. */
export function modelName(tarefa: TarefaIA = "padrao"): string {
  const padrao = escolhido("OPENROUTER_MODEL") || DEFAULT_MODEL;
  if (tarefa === "avaliacao") return escolhido("OPENROUTER_MODEL_AVALIACAO") || padrao;
  return padrao;
}

export function visionEnabled(): boolean {
  return aiEnabled();
}

export function visionModelName(): string {
  return escolhido("OPENROUTER_MODEL_VISAO") || MODELOS_VISAO[0].valor;
}

// Informações de proveniência exibidas pelo componente Origem (components/ui.tsx).
export type Meta = { demo: boolean; model: string; geradoEm: string; insumo: string };

/** `model` só é informado quando a chamada usou um modelo diferente do padrão (ex.: a tarefa de
 * avaliação): a proveniência mostrada na tela tem de ser a do modelo que realmente respondeu. */
export function meta({ demo, insumo, model }: { demo: boolean; insumo: string; model?: string }): Meta {
  return { demo, model: model || modelName(), geradoEm: new Date().toISOString(), insumo };
}

type Message = { role: "system" | "user" | "assistant"; content: string };

/** `model` troca o modelo só desta chamada (ex.: modelName("avaliacao")); sem ele vale o modelo padrão. */
export async function askText({ system, prompt, maxTokens = 4000, temperature = 0.4, model }: { system: string; prompt: string; maxTokens?: number; temperature?: number; model?: string }): Promise<string> {
  const messages: Message[] = [{ role: "system", content: system }, { role: "user", content: prompt }];
  const escolha = model || modelName();
  const fallbacks = (getConfig("OPENROUTER_FALLBACK_MODELS") || FALLBACK_MODELS.join(",")).split(",").map((m) => m.trim()).filter(Boolean);
  const res = await chamarOpenRouter({
    model: escolha,
    models: [escolha, ...fallbacks],
    messages,
    max_tokens: maxTokens,
    temperature,
  });
  if (!res.ok) {
    const detalhe = await res.text().catch(() => "");
    throw interpretarFalha(res, detalhe);
  }
  const data = await res.json();
  const texto = data?.choices?.[0]?.message?.content;
  if (!texto) throw new ErroIA("resposta_vazia", "A IA devolveu uma resposta vazia. Tente novamente.", 502);
  return String(texto);
}

type VisionContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
type VisionMessage = { role: "system" | "user"; content: string | VisionContentPart[] };

/** Manda uma imagem (data URL png ou jpeg) para o modelo de visão configurado. */
export async function askVision({
  system,
  prompt,
  imagem,
  maxTokens = 2000,
  temperature = 0.4,
}: {
  system: string;
  prompt: string;
  imagem: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  const messages: VisionMessage[] = [
    { role: "system", content: system },
    { role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: imagem } }] },
  ];
  const res = await chamarOpenRouter({
    model: visionModelName(),
    messages,
    max_tokens: maxTokens,
    temperature,
  });
  if (!res.ok) {
    const detalhe = await res.text().catch(() => "");
    if (/image|modalit|multimodal|vision/i.test(detalhe)) throw new ErroIA("sem_visao", "O modelo configurado não lê imagens.", 400);
    throw interpretarFalha(res, detalhe);
  }
  const data = await res.json();
  const texto = data?.choices?.[0]?.message?.content;
  if (!texto) throw new ErroIA("resposta_vazia", "A IA devolveu uma resposta vazia. Tente novamente.", 502);
  return String(texto);
}

/** Modelos gratuitos erram o formato JSON com frequência: uma segunda tentativa antes de desistir evita jogar fora uma resposta boa por causa de um erro isolado. */
export async function askJSON<T = unknown>(opts: { system: string; prompt: string; maxTokens?: number; model?: string }): Promise<T> {
  const system = `${opts.system}\n\nResponda somente com JSON válido, sem comentários e sem blocos de código markdown.`;
  const texto = await askText({ ...opts, system, temperature: 0.2 });
  try {
    return parseJSON<T>(texto);
  } catch {
    const segundaTentativa = await askText({ ...opts, system, temperature: 0.2 });
    try {
      return parseJSON<T>(segundaTentativa);
    } catch {
      throw new ErroIA(
        "resposta_invalida",
        "A IA respondeu em um formato inesperado. Tente de novo; se repetir, troque para um modelo pago em Configurações.",
        502
      );
    }
  }
}

export function parseJSON<T = unknown>(text: string): T {
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const inicios = ["{", "["].map((c) => t.indexOf(c)).filter((i) => i >= 0);
  const start = inicios.length ? Math.min(...inicios) : 0;
  if (start > 0) t = t.slice(start);
  const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (end > 0) t = t.slice(0, end + 1);
  return JSON.parse(t) as T;
}

// --- Tool calling (function calling) para agentes que operam ferramentas externas. ---
// Formato compatível com a API da OpenAI, servido pelo mesmo endpoint do OpenRouter.

export type ToolDefinition = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type ToolMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

/**
 * Loop manual de tool calling: envia `messages` + `tools`, e enquanto o modelo pedir
 * `finish_reason === "tool_calls"`, executa cada chamada via `executeTool` e devolve o
 * resultado como mensagem `role: "tool"`. Retorna o texto final do assistente.
 */
export async function askWithTools({
  system,
  messages,
  tools,
  executeTool,
  maxTokens = 4000,
  maxIterations = 8,
}: {
  system: string;
  messages: ToolMessage[];
  tools: ToolDefinition[];
  executeTool: (nome: string, args: Record<string, unknown>) => Promise<unknown>;
  maxTokens?: number;
  maxIterations?: number;
}): Promise<string> {
  const fallbacks = (getConfig("OPENROUTER_FALLBACK_MODELS") || FALLBACK_MODELS.join(",")).split(",").map((m) => m.trim()).filter(Boolean);
  const historico: ToolMessage[] = [{ role: "system", content: system }, ...messages];

  for (let iteracao = 0; iteracao < maxIterations; iteracao++) {
    const res = await chamarOpenRouter({
      model: modelName(),
      models: [modelName(), ...fallbacks],
      messages: historico,
      tools,
      max_tokens: maxTokens,
    });
    if (!res.ok) {
      const detalhe = await res.text().catch(() => "");
      throw interpretarFalha(res, detalhe);
    }
    const data = await res.json();
    const escolha = data?.choices?.[0];
    const mensagem = escolha?.message;
    if (!mensagem) throw new ErroIA("resposta_vazia", "A IA devolveu uma resposta vazia. Tente novamente.", 502);

    if (escolha.finish_reason !== "tool_calls" || !mensagem.tool_calls?.length) {
      return String(mensagem.content || "");
    }

    historico.push({ role: "assistant", content: mensagem.content ?? null, tool_calls: mensagem.tool_calls });
    for (const chamada of mensagem.tool_calls as ToolCall[]) {
      let resultado: unknown;
      try {
        const args = chamada.function.arguments ? JSON.parse(chamada.function.arguments) : {};
        resultado = await executeTool(chamada.function.name, args);
      } catch (err) {
        resultado = { erro: err instanceof Error ? err.message : "Falha ao executar a ação." };
      }
      historico.push({ role: "tool", tool_call_id: chamada.id, content: JSON.stringify(resultado) });
    }
  }

  return "";
}
