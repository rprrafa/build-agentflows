import { requestApi } from "@/lib/flow-api";
import { mediaCredentials } from "@/lib/media-credentials";
import { MEDIA_MODELS } from "@/lib/media-models";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  return requestApi(req, async () => ({ providers: mediaCredentials(), models: MEDIA_MODELS }));
}
