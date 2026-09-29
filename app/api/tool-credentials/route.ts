import { migrateKnowledgeCredentials } from "@/lib/knowledge-store";
import { requestApi, body } from "@/lib/flow-api";
import { listToolCredentials, saveToolCredential } from "@/lib/tool-credential-store";
import { tenantId } from "@/lib/tenant-context";
export const dynamic = "force-dynamic";
export async function GET(req: Request) { return requestApi(req, () => { if (!tenantId()) migrateKnowledgeCredentials(); return listToolCredentials(new URL(req.url).searchParams.get("provider") || undefined); }); }
export async function POST(req: Request) { return requestApi(req, async () => saveToolCredential(await body(req))); }
