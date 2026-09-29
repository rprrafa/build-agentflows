// Execução de um LLM/Agente pelo OpenRouter (mais de 500 modelos), com o mesmo contrato de
// ferramentas do ChatGPT (lib/chatgpt.ts). A chave vem da conexão em um clique (OAuth PKCE) ou
// colada em Configurações; o modelo é escolhido bloco a bloco como "openrouter:<provedor/modelo>".
import { addTokenUsage, tokenUsage, type TokenUsage } from "./token-usage";
import { interpretarFalha } from "./ai";
import { getConfig } from "./store";
import type { AgentTool } from "./chatgpt";
export const PREFIX = "openrouter:";
export const GENERATOR_MODEL = "openai/gpt-4.1-mini";
export function openRouterKey() {
  return getConfig("OPENROUTER_API_KEY") || "";
}
export function isOpenRouterModel(model?: string) {
  return !!model && model.startsWith(PREFIX);
}
export type ModelOption = { id: string; nome: string; provedor: string; inputModalities: string[] };
let cache: { at: number; modelos: ModelOption[] } | null = null;
// Catálogo público do OpenRouter, guardado por uma hora.
export async function listModels(force = false): Promise<ModelOption[]> {
  if (!force && cache && Date.now() - cache.at < 3600_000) return cache.modelos;
  const r = await fetch("https://openrouter.ai/api/v1/models", {
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error("O OpenRouter não devolveu a lista de modelos.");
  const data = (await r.json()) as { data?: { id: string; name?: string; architecture?: { input_modalities?: string[] } }[] };
  const modelos = (data.data || [])
    .filter((m) => typeof m.id === "string" && m.id.includes("/"))
    .map((m) => ({
      id: m.id,
      nome: m.name || m.id,
      provedor: m.id.split("/")[0],
      inputModalities: m.architecture?.input_modalities || ["text"],
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome));
  cache = { at: Date.now(), modelos };
  return modelos;
}
type Msg =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[] }
  | { role: "assistant"; content: string | null; tool_calls?: Call[] }
  | { role: "tool"; tool_call_id: string; content: string };
type Call = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};
export async function runOpenRouter({
  system,
  prompt,
  model,
  tools = [],
  images = [],
  signal,
  onText,
  onUsage,
  fetcher = fetch,
}: {
  system: string;
  prompt: string;
  model?: string;
  tools?: AgentTool[];
  images?: string[];
  signal?: AbortSignal;
  onText?: (text: string) => void;
  onUsage?: (usage: TokenUsage) => void;
  fetcher?: typeof fetch;
}): Promise<string> {
  const key = openRouterKey();
  if (!key) throw new Error("Conecte o OpenRouter em Configurações para usar este modelo.");
  const id = (model || "").startsWith(PREFIX) ? model!.slice(PREFIX.length) : model || GENERATOR_MODEL;
  if (images.length) {
    const selected = (await listModels()).find((m) => m.id === id);
    if (id === "openrouter/auto" || !selected?.inputModalities.includes("image")) throw new Error("Escolha um modelo OpenRouter com suporte a imagens no bloco.");
  }
  const history: Msg[] = [
    { role: "system", content: system },
    { role: "user", content: images.length ? [{ type: "text", text: prompt }, ...images.map((url) => ({ type: "image_url" as const, image_url: { url } }))] : prompt },
  ];
  let consumed: TokenUsage | undefined;
  let missingUsage = false;
  for (let round = 0; round < 12; round++) {
    if (signal?.aborted) throw new Error("Execução cancelada.");
    const res = await fetcher("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/startse/build-agentflows",
        "X-Title": "Build Agentflows",
      },
      body: JSON.stringify({
        model: id,
        messages: history,
        max_tokens: 4000,
        ...(tools.length
          ? {
              tools: tools.map((t) => ({
                type: "function",
                function: {
                  name: t.name,
                  description: t.description,
                  parameters: t.schema,
                },
              })),
            }
          : {}),
      }),
      signal,
    });
    if (!res.ok) throw interpretarFalha(res, await res.text().catch(() => ""));
    const data = await res.json();
    const usage = tokenUsage(data?.usage, "openrouter");
    if (usage) { consumed = addTokenUsage(consumed, usage); consumed.partial = missingUsage || undefined; onUsage?.(consumed); }
    else { missingUsage = true; if (consumed) { consumed.partial = true; onUsage?.(consumed); } }
    const choice = data?.choices?.[0];
    const msg = choice?.message;
    if (!msg) throw new Error("O modelo devolveu uma resposta vazia. Tente novamente.");
    const text = String(msg.content || "");
    if (text) onText?.(text);
    if (choice.finish_reason !== "tool_calls" || !msg.tool_calls?.length)
      return text;
    history.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });
    for (const call of msg.tool_calls as Call[]) {
      const tool = tools.find((t) => t.name === call.function.name);
      let result: string;
      try {
        if (!tool) throw new Error("Ferramenta não autorizada.");
        const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        result = await tool.call(args);
      } catch (err) {
        result = JSON.stringify({ erro: err instanceof Error ? err.message : "Falha na ferramenta." });
      }
      history.push({ role: "tool", tool_call_id: call.id, content: String(result).slice(0, 30000) });
    }
  }
  throw new Error("O agente excedeu o limite de chamadas de ferramentas.");
}
