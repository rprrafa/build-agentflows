import { requestApi } from "@/lib/flow-api";
import { deleteSkill, getSkill, summarizeSkill } from "@/lib/skill-service";
export const dynamic = "force-dynamic";
export async function GET(req: Request, c: { params: Promise<{ id: string }> }) {
  return requestApi(req, async () => {
    const skill = await getSkill((await c.params).id);
    return { ...summarizeSkill(skill), body: skill.body };
  });
}
export async function DELETE(req: Request, c: { params: Promise<{ id: string }> }) {
  return requestApi(req, async () => deleteSkill((await c.params).id));
}
