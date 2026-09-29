import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { AgentTool } from "./chatgpt";
import { FlowError } from "./flow-store";
async function connect(url: string, token?: string) {
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  const options = { requestInit: { headers, redirect: "error" as const }, fetch: (input: string | URL | Request, init?: RequestInit) => fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(30000)]) }) };
  let client = new Client({ name: "build-agentflows", version: "0.5.0" });
  try { await client.connect(new StreamableHTTPClientTransport(new URL(url), options)); }
  catch {
    await client.close().catch(() => {});
    client = new Client({ name: "build-agentflows", version: "0.5.0" });
    try { await client.connect(new SSEClientTransport(new URL(url), options)); }
    catch { await client.close().catch(() => {}); throw new FlowError("Não foi possível conectar ao servidor de ferramentas. Confira a credencial e suas permissões."); }
  }
  return client;
}
export async function remoteTools(prefix: string, url: string, token?: string): Promise<AgentTool[]> {
  return sessionTools(prefix, () => connect(url, token));
}
export async function localTools(prefix: string, service: "brave" | "postgres", credential: string): Promise<AgentTool[]> {
  const require = createRequire(join(process.cwd(), "package.json"));
  const entry = service === "brave" ? require.resolve("@brave/brave-search-mcp-server/dist/index.js") : require.resolve("@modelcontextprotocol/server-postgres/dist/index.js");
  return sessionTools(prefix, async () => {
    const client = new Client({ name: "build-agentflows", version: "0.9.5" });
    const transport = new StdioClientTransport({ command: process.execPath, args: service === "brave" ? [entry] : [entry, credential], env: service === "brave" ? { BRAVE_API_KEY: credential, BRAVE_MCP_TRANSPORT: "stdio" } : {}, stderr: "ignore" });
    try { await client.connect(transport, { timeout: 30000 }); return client; }
    catch { await client.close().catch(() => {}); throw new FlowError("Não foi possível conectar. Confira a credencial e tente novamente."); }
  });
}
async function sessionTools(prefix: string, connectSession: () => Promise<Client>): Promise<AgentTool[]> {
  const client = await connectSession();
  const definitions = [];
  try {
    let cursor: string | undefined;
    do { const page = await client.listTools({ cursor }); definitions.push(...page.tools); cursor = page.nextCursor; } while (cursor && definitions.length < 100);
  } finally { await client.close(); }
  const seen = new Set<string>();
  return definitions.slice(0, 100).map((tool, index) => {
    const base = `${prefix}_${tool.name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 55);
    let name = base, suffix = index;
    while (seen.has(name)) name = `${base}_${suffix++}`;
    seen.add(name);
    return {
    name, description: tool.description || tool.name, schema: tool.inputSchema,
    call: async (args) => {
      const session = await connectSession();
      try {
        const result = await session.callTool({ name: tool.name, arguments: (args || {}) as Record<string, unknown> });
        if (result.isError) throw new FlowError("O servidor não conseguiu executar a ferramenta. Confira os argumentos e permissões.");
        return JSON.stringify(result.content).slice(0, 50000);
      } finally { await session.close(); }
    },
  }; });
}
