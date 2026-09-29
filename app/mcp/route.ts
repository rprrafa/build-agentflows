import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { FERRAMENTAS, NOME_SERVIDOR } from "@/lib/ferramentas";
import { integrationApi } from "@/lib/mcp";
import { body } from "@/lib/flow-api";
import { FlowError } from "@/lib/flow-store";
import { AuthError } from "@/lib/saas-security";

export async function POST(req: Request) {
  const response = await integrationApi(req, async () => {
    const parsedBody = await body(req);
    // A fresh, stateless server per authenticated request: no shared account or transport.
    const server = new McpServer({ name: NOME_SERVIDOR, version: "1.0.0" }, { capabilities: { tools: {} } });
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: FERRAMENTAS.map(f => ({ name: f.nome, description: f.descricao, inputSchema: f.schema })),
    }));
    server.server.setRequestHandler(CallToolRequestSchema, async request => {
      const tool = FERRAMENTAS.find(f => f.nome === request.params.name);
      try {
        if (!tool) throw new FlowError("Ferramenta não encontrada.");
        const result = await tool.executar(request.params.arguments || {});
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text" as const, text: error instanceof FlowError || error instanceof AuthError ? error.message : "Não foi possível concluir. Tente novamente." }] };
      }
    });
    try {
      await server.connect(transport);
      return await transport.handleRequest(req, { parsedBody });
    } finally { await server.close(); }
  });
  if (response.ok) return response;
  const data = await response.json();
  return Response.json(data.jsonrpc ? data : { jsonrpc: "2.0", id: null, error: { code: -32000, message: data.error } }, { status: response.status, headers: response.headers });
}
export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
}
