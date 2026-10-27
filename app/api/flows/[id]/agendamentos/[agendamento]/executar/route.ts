import { requestApi } from "@/lib/flow-api";
import { runFlowScheduleNow } from "@/lib/tenant-schedules";
type Context = { params: Promise<{ id: string; agendamento: string }> };
export async function POST(req: Request, c: Context) {
  return requestApi(req, async () => { const { id, agendamento } = await c.params; return runFlowScheduleNow(id, agendamento); });
}
