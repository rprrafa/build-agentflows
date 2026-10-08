import { tenantApi } from "@/lib/saas-http";
import { currentTenant } from "@/lib/tenant-context";
import { accountProfile } from "@/lib/saas-auth";
import { accountUsage } from "@/lib/saas-plan";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  return tenantApi(req, async () => {
    const { db, user } = currentTenant();
    return { ...(await accountProfile(db, user.id)), usage: await accountUsage(db, user.id) };
  });
}
