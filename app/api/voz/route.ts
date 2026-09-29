import { falaDisponivel, ligacaoDisponivel } from "@/lib/elevenlabs";
import { requestApi } from "@/lib/flow-api";
export const dynamic = "force-dynamic";
export async function GET(req?: Request) {
  return requestApi(req, () => ({ voz: falaDisponivel(), ligacao: ligacaoDisponivel() }));
}
