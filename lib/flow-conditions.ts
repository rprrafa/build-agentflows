export const COMPARISONS = [
  ["equals", "É igual a"], ["contains", "Contém"], ["notEquals", "É diferente de"],
  ["notContains", "Não contém"], ["greater", "É maior que"], ["greaterOrEqual", "É maior ou igual a"],
  ["less", "É menor que"], ["lessOrEqual", "É menor ou igual a"], ["empty", "Está vazio"], ["notEmpty", "Não está vazio"],
] as const;
export type Criterion = { id: string; value: string; operator: string; compare: string };
export const FALLBACK_HANDLE = "no";
export function conditionCriteria(config: Record<string, string>): Criterion[] {
  if (config.criteria === undefined) return [{ id: "yes", value: config.value || "", operator: config.operator || "contains", compare: config.compare || "" }];
  let rows: Criterion[];
  try { rows = JSON.parse(config.criteria); } catch { throw new Error("Confira os critérios da condição."); }
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 119 || rows.some((row) =>
    !row || typeof row.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(row.id) || row.id === FALLBACK_HANDLE ||
    typeof row.value !== "string" || typeof row.compare !== "string" || !COMPARISONS.some(([id]) => id === row.operator)
  ) || new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error("Use critérios válidos, com pelo menos uma comparação.");
  return rows;
}
export function matchesCriterion(operator: string, value: string, expected: string): boolean {
  switch (operator) {
    case "equals": return value === expected;
    case "notEquals": return value !== expected;
    case "contains": return value.toLocaleLowerCase().includes(expected.toLocaleLowerCase());
    case "notContains": return !value.toLocaleLowerCase().includes(expected.toLocaleLowerCase());
    case "empty": return !value.trim();
    case "notEmpty": return !!value.trim();
    case "greater": return Number(value) > Number(expected);
    case "greaterOrEqual": return Number(value) >= Number(expected);
    case "less": return Number(value) < Number(expected);
    case "lessOrEqual": return Number(value) <= Number(expected);
    default: throw new Error("Escolha uma comparação válida.");
  }
}
