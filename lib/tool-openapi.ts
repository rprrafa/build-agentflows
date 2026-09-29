import { toolConfig as getConfig } from "./tool-config-context";
import { fetchText } from "./tools";
import { publicUrl } from "./tool-services";
import { FlowError } from "./flow-store";
import type { AgentTool } from "./chatgpt";
type Obj = Record<string, unknown>;
const record = (v: unknown): Obj => v && typeof v === "object" && !Array.isArray(v) ? v as Obj : {};
export async function openApiTools(): Promise<AgentTool[]> {
  const source = getConfig("TOOL_OPENAPI_URL");
  if (!source) throw new FlowError("Configure o endereço da especificação OpenAPI no Agente.");
  let spec: Obj;
  try { spec = JSON.parse(await fetchText(source)); } catch { throw new FlowError("Não foi possível ler a especificação OpenAPI em JSON."); }
  if (!String(spec.openapi).startsWith("3.")) throw new FlowError("Use uma especificação OpenAPI 3 em JSON.");
  function deref(value: unknown, depth = 0): Obj {
    const o = record(value);
    if (!o.$ref) return o;
    const ref = String(o.$ref);
    if (!ref.startsWith("#/") || depth > 12) throw new FlowError("A especificação contém uma referência externa ou circular não suportada.");
    let target: unknown = spec;
    for (const part of ref.slice(2).split("/")) target = record(target)[part.replace(/~1/g, "/").replace(/~0/g, "~")];
    if (!target) throw new FlowError("Referência ausente na especificação OpenAPI.");
    return deref(target, depth + 1);
  }
  function schemaFor(value: unknown, depth = 0): unknown {
    if (depth > 20) throw new FlowError("A especificação contém um schema circular ou muito profundo.");
    if (Array.isArray(value)) return value.map((v) => schemaFor(v, depth + 1));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(deref(value)).map(([k, v]) => [k, schemaFor(v, depth + 1)]));
  }
  const tools: AgentTool[] = [];
  for (const [path, pathValue] of Object.entries(record(spec.paths))) {
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("..")) throw new FlowError("Caminho inválido na especificação OpenAPI.");
    const item = deref(pathValue);
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      if (!item[method]) continue;
      const op = deref(item[method]);
      const servers = (op.servers || item.servers || spec.servers) as { url?: string }[] | undefined;
      const base = publicUrl(new URL(servers?.[0]?.url || "/", source).toString());
      const parameters = [...(Array.isArray(item.parameters) ? item.parameters : []), ...(Array.isArray(op.parameters) ? op.parameters : [])].map((p) => deref(p));
      const properties: Obj = {}, required: string[] = [];
      for (const p of parameters) {
        if (!["path", "query"].includes(String(p.in))) continue;
        properties[String(p.name)] = schemaFor(p.schema);
        if (p.required) required.push(String(p.name));
      }
      const requestBody = deref(op.requestBody), bodySchema = record(record(requestBody.content)["application/json"]).schema;
      if (bodySchema) { properties.corpo = schemaFor(bodySchema); if (requestBody.required) required.push("corpo"); }
      const rawName = String(op.operationId || `${method}_${path}`);
      tools.push({ name: `openapi_${tools.length}_${rawName}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64),
        description: String(op.summary || op.description || `${method.toUpperCase()} ${path}`).slice(0, 2000), schema: { type: "object", properties, required },
        call: async (input) => {
          const args = record(input);
          for (const key of required) if (args[key] === undefined || args[key] === null) throw new FlowError(`Informe ${key}.`);
          let target = path;
          for (const p of parameters.filter((p) => p.in === "path")) {
            const v = String(args[String(p.name)] ?? "");
            if (v === "." || v === ".." || v.includes("/")) throw new FlowError("Parâmetro de caminho inválido.");
            target = target.replaceAll(`{${p.name}}`, encodeURIComponent(v));
          }
          if (/[{}]/.test(target)) throw new FlowError("Preencha os parâmetros de caminho.");
          const url = publicUrl(base.toString().replace(/\/$/, "") + target);
          for (const p of parameters.filter((p) => p.in === "query")) if (args[String(p.name)] !== undefined) url.searchParams.set(String(p.name), String(args[String(p.name)]));
          const token = getConfig("TOOL_OPENAPI_TOKEN");
          const res = await fetch(url, { method: method.toUpperCase(), headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: method === "get" || args.corpo === undefined ? undefined : JSON.stringify(args.corpo), redirect: "error", signal: AbortSignal.timeout(30000) });
          if (!res.ok) throw new FlowError(`A operação respondeu com erro ${res.status}.`);
          return (await res.text()).slice(0, 50000) || "Operação concluída.";
        } });
    }
  }
  if (!tools.length) throw new FlowError("A especificação não contém operações disponíveis.");
  return tools.slice(0, 100);
}
