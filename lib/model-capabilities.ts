import type { Graph } from "./flow-types";
export type ModelCapability = { id: string; name: string; inputModalities: string[]; isDefault?: boolean };
export type ImageIssue = { nodeId: string; label: string; reason: string };
export function reachableAiNodes(graph: Graph) {
  const reachable = new Set<string>();
  const visit = (id: string) => {
    if (reachable.has(id)) return;
    reachable.add(id);
    graph.edges.filter((e) => e.source === id).forEach((e) => visit(e.target));
  };
  graph.nodes.filter((n) => n.data.kind === "start").forEach((n) => visit(n.id));
  return graph.nodes.filter((n) => reachable.has(n.id) && ["agent", "llm"].includes(n.data.kind));
}
export function imageIssues(graph: Graph, models: ModelCapability[]): ImageIssue[] {
  const nodes = reachableAiNodes(graph);
  if (!nodes.length) return [{ nodeId: "", label: "Este fluxo", reason: "Adicione um bloco de IA para analisar imagens." }];
  return nodes.flatMap((n) => {
    const id = n.data.config.model;
    const model = id ? models.find((m) => m.id === id) : models.find((m) => m.isDefault && !m.id.startsWith("openrouter:"));
    const reason = id === "openrouter:openrouter/auto" ? "Escolha um modelo específico que aceite imagens."
      : !model ? "Não foi possível confirmar o suporte a imagens deste modelo."
      : !model.inputModalities.includes("image") ? `${model.name} não aceita imagens.` : "";
    return reason ? [{ nodeId: n.id, label: n.data.label, reason }] : [];
  });
}
