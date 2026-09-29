/** Shared wire contract. No credentials or server imports in this module. */
export const PAGE_ACTIONS = {
  "page.getContext": "Conhecer a página aberta",
  "page.inspect": "Consultar elementos da página",
  "page.selectElement": "Pedir que você indique um elemento",
  "page.highlight": "Destacar um elemento",
  "page.scroll": "Rolar a página",
  "page.click": "Clicar em um elemento",
  "page.navigate": "Abrir outra página",
  "page.requestScreenshot": "Pedir uma captura da tela",
} as const;
export type PageAction = keyof typeof PAGE_ACTIONS;
export type PageCapability = { name: string; description: string; schema: Record<string, unknown> };
export type PageCommand = {
  id: string; sessionId: string; runId: string; name: string; args: unknown;
  status: "pending" | "delivered" | "completed" | "failed" | "expired" | "cancelled";
  createdAt: number; expiresAt: number; result?: string;
};
export type EmbedSettings = { displayMode?: "detailed" | "simple"; enabled: boolean; origins: string[]; agentName?: string; avatarUrl?: string; title: string; welcome: string; maxMinutes: number; maxCommands: number };
export type EmbedTurn = {
  id: string; input: string; output: string; status: string; error?: string;
  activity: string; approval?: string; createdAt: string; updatedAt: string;
  attachments?: { id: string; name: string }[];
};
export const ACTION_SCHEMA = {
  type: "object", properties: {
    selector: { type: "string", description: "Seletor de um elemento identificado na página" },
    url: { type: "string", description: "Rota na mesma aplicação" },
    top: { type: "number" },
  }, additionalProperties: false,
};
export function validCapabilities(value: unknown): PageCapability[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error("Capacidades da página inválidas.");
  const names = new Set<string>();
  return value.map((v) => {
    if (!v || typeof v.name !== "string" || !/^(page\.[a-zA-Z]+|app\.[a-zA-Z][a-zA-Z0-9]{0,48})$/.test(v.name) || names.has(v.name)) throw new Error("Ação da página inválida ou repetida.");
    names.add(v.name);
    if (v.name.startsWith("page.") && !Object.hasOwn(PAGE_ACTIONS, v.name)) throw new Error("Ação padrão desconhecida.");
    if (typeof v.description !== "string" || v.description.length > 500 || !v.schema || v.schema.type !== "object" || JSON.stringify(v.schema).length > 4000) throw new Error("Descrição da ação inválida.");
    return { name: v.name, description: v.description, schema: v.schema };
  });
}
