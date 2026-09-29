import { toolConfig } from "./tool-config-context";
import { FlowError } from "./flow-store";
import type { AgentTool } from "./chatgpt";
type Item = { id?: string; slug?: string; name?: string; status?: string; user_id?: string; no_auth?: boolean; version?: string; description?: string; input_parameters?: Record<string, unknown> };
async function composio(path: string, init: RequestInit = {}) {
  const response = await fetch(`https://backend.composio.dev/api/v3/${path}`, { ...init, headers: { "x-api-key": toolConfig("TOOL_COMPOSIO_KEY") || "", "Content-Type": "application/json" }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new FlowError(`A Composio respondeu com erro ${response.status}. Confira a credencial e a conta conectada.`);
  return response.json();
}
async function pages(path: string): Promise<Item[]> {
  const result: Item[] = []; let cursor = "";
  do {
    const data = await composio(`${path}${path.includes("?") ? "&" : "?"}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    result.push(...(data.items || [])); cursor = data.next_cursor || "";
  } while (cursor && result.length < 1000);
  return result;
}
export async function composioOptions(kind: "apps" | "accounts", app = "") {
  const items = await pages(kind === "apps" ? "toolkits" : `connected_accounts?toolkit_slugs=${encodeURIComponent(app)}&statuses=ACTIVE`);
  return items.filter((item) => kind === "apps" || item.status === "ACTIVE").map((item) => ({ id: kind === "apps" ? item.slug! : item.id!, name: item.name || item.user_id || item.slug || item.id! })).sort((a,b) => a.name.localeCompare(b.name));
}
export async function composioTools(params: Record<string, string>): Promise<AgentTool[]> {
  if (!params.app) throw new FlowError("Selecione um aplicativo da Composio.");
  const items = await pages(`tools?toolkit_slug=${encodeURIComponent(params.app)}&toolkit_versions=latest`);
  return items.map((item) => {
    const input = item.input_parameters || {};
    const schema = input.type ? input : { type: "object", properties: input, required: Object.entries(input).filter(([, field]) => !!(field as { required?: boolean })?.required).map(([key]) => key) };
    return { name: item.slug!, description: item.description || item.name || item.slug!, schema, call: async (args: unknown) => {
      if (!item.no_auth && !params.connectedAccountId) throw new FlowError("Selecione uma conta conectada na Composio.");
      const result = await composio(`tools/execute/${encodeURIComponent(item.slug!)}`, { method: "POST", body: JSON.stringify({ arguments: args, connected_account_id: params.connectedAccountId || undefined, version: item.version || "latest" }) });
      if (result.successful === false || result.error) throw new FlowError("A Composio não conseguiu executar a ação. Confira a conta e os parâmetros.");
      return JSON.stringify(result.data ?? result).slice(0, 50000);
    } };
  });
}
