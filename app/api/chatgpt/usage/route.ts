import { chatGPT } from "@/lib/chatgpt";
import { requestApi } from "@/lib/flow-api";
export const dynamic = "force-dynamic";
export async function GET(req?: Request) {
  return requestApi(req, () => chatGPT().usage());
}
