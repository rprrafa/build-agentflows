import { requestApi, body } from "@/lib/flow-api";
import { deleteFlowSchedule, setFlowScheduleActive, updateFlowSchedule } from "@/lib/tenant-schedules";
type Context = { params: Promise<{ id: string; agendamento: string }> };
export async function PUT(req: Request, c: Context) {
  return requestApi(req, async () => { const { id, agendamento } = await c.params; return { agendamento: await updateFlowSchedule(id, agendamento, await body(req)) }; });
}
/** Pausar ou retomar: { "active": boolean }. */
export async function PATCH(req: Request, c: Context) {
  return requestApi(req, async () => { const { id, agendamento } = await c.params; return { agendamento: await setFlowScheduleActive(id, agendamento, (await body(req)).active) }; });
}
export async function DELETE(req: Request, c: Context) {
  return requestApi(req, async () => { const { id, agendamento } = await c.params; await deleteFlowSchedule(id, agendamento); return { ok: true }; });
}
