import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { conditionCriteria, matchesCriterion, COMPARISONS } from "./flow-conditions";
import { outputs, connectionProblem } from "./flow-graph";
import { block, type Graph } from "./flow-types";
const dir = mkdtempSync(join(tmpdir(), "conditions-test-")); process.env.DATA_DIR = dir;
const store = await import("./flow-store");
const runtime = await import("./flow-runtime");
const { parseGenerated } = await import("./flow-generator");
test.after(() => rmSync(dir, { recursive: true, force: true }));
const rows = [
  { id: "yes", value: "{{input}}", operator: "equals", compare: "urgente" },
  { id: "criterion_2", value: "{{input}}", operator: "contains", compare: "pedido" },
  { id: "criterion_3", value: "{{input}}", operator: "contains", compare: "urgente" },
];
function graph(): Graph {
  const start = block("start", "inicio", 0, 0), condition = block("condition", "cond", 320, 0);
  condition.data.config.criteria = JSON.stringify(rows);
  const ends = ["yes", "criterion_2", "criterion_3", "no"].map((id, i) => { const n = block("end", "end_" + id, 640, i * 100); n.data.config.text = id; return n; });
  return { nodes: [start, condition, ...ends], edges: [{ id: "start", source: "inicio", target: "cond" }, ...ends.map((n, i) => ({ id: n.id, source: "cond", sourceHandle: [...rows.map((r) => r.id), "no"][i], target: n.id }))] };
}
test("critérios numerados preservam IDs estáveis e a última saída automática", () => {
  assert.deepEqual(outputs("condition", { criteria: JSON.stringify(rows) }), [{ id: "yes", label: "1" }, { id: "criterion_2", label: "2" }, { id: "criterion_3", label: "3" }, { id: "no", label: "4" }]);
  assert.deepEqual(outputs("condition", { criteria: JSON.stringify([rows[0], rows[2]]) }).map((o) => o.id), ["yes", "criterion_3", "no"]);
  assert.equal(outputs("condition").length, 2);
  for (const invalid of [[], [{ ...rows[0], id: "no" }], [rows[0], rows[0]], [{ ...rows[0], operator: "invalid" }]]) assert.throws(() => conditionCriteria({ criteria: JSON.stringify(invalid) }));
});
test("comparadores aceitam texto, valores numéricos e campos vazios", () => {
  const cases: Record<string, [string, string]> = { equals: ["a", "a"], contains: ["PEDIDO urgente", "pedido"], notEquals: ["a", "b"], notContains: ["pedido", "outro"], greater: ["10", "2"], greaterOrEqual: ["2", "2"], less: ["2", "10"], lessOrEqual: ["2", "2"], empty: ["  ", ""], notEmpty: ["a", ""] };
  for (const [id] of COMPARISONS) assert.equal(matchesCriterion(id, ...cases[id]), true, id);
  assert.equal(matchesCriterion("greater", "texto", "2"), false);
});
test("execução usa primeiro critério atendido, saídas extras e caso contrário", async () => {
  const g = graph();
  store.validateGraph(g, true);
  const f = store.createSavedFlow({ name: "Critérios", description: "", graph: g });
  for (const [input, expected] of [["urgente", "yes"], ["pedido urgente", "criterion_2"], ["muito urgente", "criterion_3"], ["normal", "no"]]) {
    const run = await runtime.startRun(f.id, input, false, true);
    assert.equal(run.status, "completed"); assert.equal(run.output, expected);
  }
  assert.deepEqual(store.getFlow(f.id).graph, g);
  const incomplete = structuredClone(g); incomplete.edges.pop();
  assert.throws(() => store.validateGraph(incomplete, true), /saídas/);
  assert.equal(connectionProblem({ ...g, edges: g.edges.filter((e) => e.sourceHandle !== "criterion_2") }, { source: "cond", sourceHandle: "criterion_2", target: "end_criterion_2" }), null);
});
test("condições antigas seguem funcionando sem modificar conexões sim/não", async () => {
  const g = graph();
  g.nodes[1].data.config = { value: "{{input}}", operator: "equals", compare: "urgente" };
  g.nodes = g.nodes.filter((n) => !n.id.includes("criterion_"));
  g.edges = g.edges.filter((e) => !e.target.includes("criterion_"));
  const f = store.createSavedFlow({ name: "Antigo", description: "", graph: g });
  assert.equal((await runtime.startRun(f.id, "urgente", false, true)).output, "yes");
  assert.equal((await runtime.startRun(f.id, "outro", false, true)).output, "no");
});
test("geração por IA aceita critérios e preserva todas as saídas", () => {
  const g = graph();
  const generated = parseGenerated(JSON.stringify({ name: "Critérios", nodes: g.nodes.map((n) => ({ id: n.id, kind: n.data.kind, label: n.data.label, config: n.data.kind === "condition" ? { criteria: rows } : n.data.config })), edges: g.edges.map((e) => ({ ...e, handle: 'sourceHandle' in e ? e.sourceHandle : undefined })) }));
  assert.equal(outputs("condition", generated.graph.nodes[1].data.config).length, 4);
  assert.deepEqual(generated.graph.edges.map((e) => e.sourceHandle).filter(Boolean), ["yes", "criterion_2", "criterion_3", "no"]);
});
