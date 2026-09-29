import { chatGPT } from "./chatgpt";
import { listModels } from "./openrouter";
import { imageIssues, reachableAiNodes, type ModelCapability } from "./model-capabilities";
import type { Graph } from "./flow-types";
import { FlowError } from "./flow-store";
export async function assertImageModels(graph: Graph) {
  const nodes = reachableAiNodes(graph);
  const models: ModelCapability[] = [];
  try {
    if (nodes.some((n) => !n.data.config.model?.startsWith("openrouter:"))) models.push(...await chatGPT().models());
    if (nodes.some((n) => n.data.config.model?.startsWith("openrouter:"))) models.push(...(await listModels()).map((m) => ({ id: `openrouter:${m.id}`, name: m.nome, inputModalities: m.inputModalities })));
  } catch { throw new FlowError("Não foi possível verificar os modelos para imagens. Atualize as configurações e tente novamente."); }
  const issues = imageIssues(graph, models);
  if (issues.length) throw new FlowError(`Revise os modelos antes de enviar imagens: ${issues.map((i) => `${i.label}: ${i.reason}`).join(" ")}`);
}
