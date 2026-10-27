import { requestApi } from "@/lib/flow-api";
import { FlowError } from "@/lib/flow-store";
import { uploadForm } from "@/lib/attachment-service";
import { listSkills, saveSkill } from "@/lib/skill-service";
export const dynamic = "force-dynamic";
export async function GET(req?: Request) {
  return requestApi(req, () => listSkills());
}
// Envio de habilidade: um SKILL.md ou um .zip com a pasta da habilidade, no campo file.
export async function POST(req: Request) {
  return requestApi(req, async () => {
    const form = await uploadForm(req);
    const file = form.get("file");
    if (!(file instanceof File) || form.getAll("file").length !== 1) throw new FlowError("Envie um arquivo SKILL.md ou um .zip por vez.");
    return saveSkill(file);
  });
}
