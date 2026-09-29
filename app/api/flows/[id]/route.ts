import { tenantApi, limitedJson } from "@/lib/saas-http";
import { getTenantFlow, saveTenantFlow, deleteTenantFlow } from "@/lib/tenant-flows";
type C = { params: Promise<{ id: string }> };
export async function GET(req: Request, c: C) { return tenantApi(req, async () => getTenantFlow((await c.params).id)); }
export async function PUT(req: Request, c: C) { return tenantApi(req, async () => saveTenantFlow((await c.params).id, await limitedJson(req, 300000))); }
export async function DELETE(req: Request, c: C) { return tenantApi(req, async () => { await deleteTenantFlow((await c.params).id); return { ok: true }; }); }
