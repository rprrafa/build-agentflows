import { limitedJson, sessionToken, tenantApi } from "@/lib/saas-http";
import { currentTenant } from "@/lib/tenant-context";
import { changePassword } from "@/lib/saas-auth";
import { AuthError } from "@/lib/saas-security";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  return tenantApi(req, async () => {
    const data = await limitedJson(req);
    if (data.password !== data.confirmPassword) throw new AuthError("As senhas não são iguais.");
    const { db, user } = currentTenant();
    await changePassword(db, user.id, { current: data.current, password: data.password }, sessionToken(req));
    return { ok: true };
  });
}
