import { importModelCredentials } from "@/lib/ai-credentials";
import { requestApi, body } from "@/lib/flow-api";
import { listToolCredentials, saveToolCredential } from "@/lib/tool-credential-store";
export const dynamic = "force-dynamic";
export async function GET(req: Request) { return requestApi(req, () => { importModelCredentials(); return listToolCredentials(new URL(req.url).searchParams.get("provider") || undefined); }); }
export async function POST(req: Request) { return requestApi(req, async () => saveToolCredential(await body(req))); }
