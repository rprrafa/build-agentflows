import { requestApi, body } from "@/lib/flow-api";
import { deleteToolCredential, getToolCredential, saveToolCredential } from "@/lib/tool-credential-store";
type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export async function GET(req: Request, c: Context) { return requestApi(req, async () => getToolCredential((await c.params).id)); }
export async function PUT(req: Request, c: Context) { return requestApi(req, async () => saveToolCredential(await body(req), (await c.params).id)); }
export async function DELETE(req: Request, c: Context) { return requestApi(req, async () => { deleteToolCredential((await c.params).id); return { ok: true }; }); }
