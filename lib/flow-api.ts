import { FlowError } from "./flow-store";
import { saasEnabled } from "./tenant-context";
import { limitedJson, privateJson, tenantApi } from "./saas-http";
export async function body(req: Request) {
  if (saasEnabled()) return limitedJson(req, 300000);
  const text = await req.text();
  if (text.length > 300000)
    throw new FlowError("O arquivo excede 300 KB.", 413);
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value;
  } catch {
    throw new FlowError("Envie um objeto JSON válido.");
  }
}

export function requestApi(req: Request | undefined, action: () => unknown | Promise<unknown>) {
  if (!saasEnabled()) return api(action);
  if (!req) return Promise.resolve(privateJson({ error: "Entre na sua conta." }, { status: 401 }));
  return tenantApi(req, action);
}
export async function api(fn: () => unknown | Promise<unknown>) {
  try {
    const result = await fn();
    if (result instanceof Response) return result;
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Não foi possível concluir." },
      { status: e instanceof FlowError ? e.status : 500 },
    );
  }
}
