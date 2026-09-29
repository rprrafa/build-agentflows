import { FlowError } from "./flow-store";
import { limitedJson, privateJson, tenantApi } from "./saas-http";
export async function body(req: Request) {
  return limitedJson(req, 300000);
}

export function requestApi(req: Request | undefined, action: () => unknown | Promise<unknown>) {
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
