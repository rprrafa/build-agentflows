// Compartilhado pela edição, validação e execução dos blocos Agente e LLM.
export const MEMORY_TYPES = [
  { value: "allMessages", label: "Todas as mensagens", help: "Usa o histórico da conversa e as respostas anteriores dos agentes neste fluxo." },
  { value: "windowSize", label: "Últimas mensagens", help: "Usa apenas a quantidade escolhida de mensagens anteriores, além da mensagem desta etapa." },
  { value: "conversationSummary", label: "Resumo da conversa", help: "Resume o histórico com o modelo deste bloco antes de responder. Faz uma chamada extra à IA." },
  { value: "conversationSummaryBuffer", label: "Resumo e mensagens recentes", help: "Resume as mensagens antigas quando o histórico ultrapassa o limite e mantém as recentes. Pode fazer uma chamada extra à IA." },
] as const;
export type MemoryType = typeof MEMORY_TYPES[number]["value"];
export const MEMORY_DEFAULTS = { memoryEnabled: "true", memoryType: "allMessages", memoryWindowSize: "20", memoryMaxTokens: "2000" } as const;

export function memorySettings(config: Record<string, string>) {
  const enabled = config.memoryEnabled ?? MEMORY_DEFAULTS.memoryEnabled;
  if (enabled !== "true" && enabled !== "false") throw new Error("Ative ou desative a memória do bloco.");
  const type = config.memoryType ?? MEMORY_DEFAULTS.memoryType;
  if (!MEMORY_TYPES.some((option) => option.value === type)) throw new Error("Escolha um tipo de memória válido.");
  const number = (key: "memoryWindowSize" | "memoryMaxTokens", min: number, max: number, label: string) => {
    const raw = config[key] ?? MEMORY_DEFAULTS[key];
    if (!/^\d+$/.test(raw) || +raw < min || +raw > max) throw new Error(`${label} deve ser um número inteiro entre ${min} e ${max}.`);
    return +raw;
  };
  return {
    enabled: enabled === "true",
    type: type as MemoryType,
    windowSize: enabled === "true" && type === "windowSize" ? number("memoryWindowSize", 1, 1000, "A quantidade de mensagens") : +MEMORY_DEFAULTS.memoryWindowSize,
    maxTokens: enabled === "true" && type === "conversationSummaryBuffer" ? number("memoryMaxTokens", 100, 128000, "O limite aproximado de tokens") : +MEMORY_DEFAULTS.memoryMaxTokens,
  };
}
