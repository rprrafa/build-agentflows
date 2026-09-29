import { FlowError, getRun } from "./flow-store";
import type { Run } from "./flow-types";
import { tenantId } from "./tenant-context";
import { getTenantRun } from "./tenant-flows";
export async function tenantConversationHistory(flowId: string, ids: unknown): Promise<NonNullable<Run["conversation"]>> {
  if (!tenantId()) return conversationHistory(flowId, ids);
  if (ids === undefined) return [];
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string") || new Set(ids).size !== ids.length) throw new FlowError("Histórico da conversa inválido.");
  if (ids.length > 1000) throw new FlowError("Esta conversa atingiu mil interações. Inicie uma nova conversa.");
  const result: NonNullable<Run["conversation"]> = [];
  for (const id of ids) {
    const run = await getTenantRun(id);
    if (run.flowId !== flowId || run.status !== "completed" || run.demo) throw new FlowError("Use apenas respostas concluídas deste fluxo na conversa.");
    result.push({ input: run.input, output: run.output });
  }
  return result;
}
export function conversationHistory(flowId: string, ids: unknown): NonNullable<Run["conversation"]> {
  if (ids === undefined) return [];
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string") || new Set(ids).size !== ids.length) throw new FlowError("Histórico da conversa inválido.");
  if (ids.length > 1000) throw new FlowError("Esta conversa atingiu mil interações. Inicie uma nova conversa.");
  return ids.map((id) => {
    const run = getRun(id);
    if (run.flowId !== flowId || run.status !== "completed" || run.demo) throw new FlowError("Use apenas respostas concluídas deste fluxo na conversa.");
    return { input: run.input, output: run.output };
  });
}
