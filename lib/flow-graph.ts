import { conditionCriteria, FALLBACK_HANDLE } from "./flow-conditions";
import type { Graph, Kind, Link } from "./flow-types";
export type Output = { id: string | null; label: string };
// Saídas de cada tipo de bloco, na ordem em que aparecem no lado direito.
export function outputs(kind: Kind, config: Record<string, string> = {}): Output[] {
  if (kind === "condition") {
    const criteria = conditionCriteria(config);
    return [...criteria.map((row, index) => ({ id: row.id, label: String(index + 1) })), { id: FALLBACK_HANDLE, label: String(criteria.length + 1) }];
  }
  if (kind === "approval")
    return [
      { id: "yes", label: "Aprovar" },
      { id: "no", label: "Rejeitar" },
    ];
  if (kind === "loop")
    return [
      { id: "repeat", label: "Repetir" },
      { id: "done", label: "Concluir" },
    ];
  if (kind === "end") return [];
  return [{ id: null, label: "" }];
}
export function outputLabel(kind: Kind, handle?: string | null, config: Record<string, string> = {}) {
  return outputs(kind, config).find((o) => o.id === (handle || null))?.label || "";
}
export type Candidate = {
  source: string;
  target: string;
  sourceHandle?: string | null;
};
function isRepeat(g: Graph, e: Link) {
  return (
    e.sourceHandle === "repeat" &&
    g.nodes.find((n) => n.id === e.source)?.data.kind === "loop"
  );
}
// Existe caminho de `from` até `to` sem passar por saídas Repetir?
function reaches(g: Graph, from: string, to: string) {
  const seen = new Set<string>();
  const queue = [from];
  while (queue.length) {
    const id = queue.shift()!;
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of g.edges)
      if (e.source === id && !isRepeat(g, e)) queue.push(e.target);
  }
  return false;
}
// Motivo pelo qual a conexão não pode ser feita, ou null quando é válida.
export function connectionProblem(g: Graph, c: Candidate): string | null {
  if (c.source === c.target)
    return "Conecte blocos diferentes. Para voltar a uma etapa, use Repetir.";
  const source = g.nodes.find((n) => n.id === c.source),
    target = g.nodes.find((n) => n.id === c.target);
  if (!source || !target) return "Bloco não encontrado.";
  if (target.data.kind === "start") return "O Início não recebe conexões.";
  const handle = c.sourceHandle || null;
  if (!outputs(source.data.kind, source.data.config).some((o) => o.id === handle))
    return source.data.kind === "condition" ? "Esta saída não existe mais. Confira os critérios do bloco." : "A Resposta encerra o fluxo e não tem saída.";
  if (
    g.edges.some(
      (e) => e.source === c.source && (e.sourceHandle || null) === handle,
    )
  )
    return "Esta saída já está conectada. Remova a conexão atual ou use uma Condição para ramificar.";
  const repeat = source.data.kind === "loop" && handle === "repeat";
  if (!repeat && reaches(g, c.target, c.source))
    return "Essa conexão criaria um ciclo. Para repetir etapas, use o bloco Repetir.";
  return null;
}
export function edgeId(c: Candidate) {
  return `${c.source}-${c.sourceHandle || "out"}-${c.target}`;
}
export function connect(g: Graph, c: Candidate): Graph {
  const edge: Link = { id: edgeId(c), source: c.source, target: c.target };
  if (c.sourceHandle) edge.sourceHandle = c.sourceHandle;
  return { ...g, edges: [...g.edges, edge] };
}
// Organiza os blocos em colunas pela distância do Início (usado por fluxos gerados por IA).
export function layout(g: Graph): Graph {
  const start = g.nodes.find((n) => n.data.kind === "start") || g.nodes[0];
  if (!start) return g;
  const depth = new Map<string, number>([[start.id, 0]]);
  const queue = [start.id];
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of g.edges)
      if (e.source === id && !depth.has(e.target)) {
        depth.set(e.target, depth.get(id)! + 1);
        queue.push(e.target);
      }
  }
  let orphan = Math.max(0, ...depth.values()) + 1;
  for (const n of g.nodes) if (!depth.has(n.id)) depth.set(n.id, orphan++);
  const rows = new Map<number, number>();
  return {
    ...g,
    nodes: g.nodes.map((n) => {
      const d = depth.get(n.id)!;
      const row = rows.get(d) || 0;
      rows.set(d, row + 1);
      return { ...n, position: { x: 60 + d * 340, y: 80 + row * 170 } };
    }),
  };
}
