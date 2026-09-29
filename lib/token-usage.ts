export type TokenUsage = { input: number; output: number; total: number; cachedInput?: number; reasoning?: number; partial?: boolean };
function count(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined; }
export function tokenUsage(value: unknown, provider: "chatgpt" | "openrouter"): TokenUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const input = count(provider === "chatgpt" ? v.inputTokens : v.prompt_tokens);
  const output = count(provider === "chatgpt" ? v.outputTokens : v.completion_tokens);
  if (input === undefined || output === undefined) return undefined;
  const details = v.prompt_tokens_details as { cached_tokens?: unknown } | undefined;
  const completion = v.completion_tokens_details as { reasoning_tokens?: unknown } | undefined;
  return { input, output, total: count(provider === "chatgpt" ? v.totalTokens : v.total_tokens) ?? input + output,
    cachedInput: count(provider === "chatgpt" ? v.cachedInputTokens : details?.cached_tokens),
    reasoning: count(provider === "chatgpt" ? v.reasoningOutputTokens : completion?.reasoning_tokens) };
}
export function addTokenUsage(a: TokenUsage | undefined, b: TokenUsage): TokenUsage {
  if (!a) return { ...b };
  return { input: a.input + b.input, output: a.output + b.output, total: a.total + b.total,
    cachedInput: a.cachedInput === undefined && b.cachedInput === undefined ? undefined : (a.cachedInput || 0) + (b.cachedInput || 0),
    reasoning: a.reasoning === undefined && b.reasoning === undefined ? undefined : (a.reasoning || 0) + (b.reasoning || 0), partial: a.partial || b.partial || undefined };
}
