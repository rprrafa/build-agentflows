import { requestApi, body } from "@/lib/flow-api";
import { createFlowSchedule, listFlowSchedules } from "@/lib/tenant-schedules";
type Context = { params: Promise<{ id: string }> };
export async function GET(req: Request, c: Context) {
  return requestApi(req, async () => ({ agendamentos: await listFlowSchedules((await c.params).id) }));
}
export async function POST(req: Request, c: Context) {
  return requestApi(req, async () => ({ agendamento: await createFlowSchedule((await c.params).id, await body(req)) }));
}
