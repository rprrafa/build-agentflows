import { notFound } from "next/navigation";
import { getRun } from "@/lib/flow-store";
import { RunView } from "@/components/RunView";
import { cookies } from "next/headers";
import { saasEnabled, withTenantSession } from "@/lib/tenant-context";
import { saasDatabase } from "@/lib/saas-db";
import { SAAS_SESSION_COOKIE } from "@/lib/saas-auth";
import { getTenantRun } from "@/lib/tenant-flows";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  let run;
  try {
    const { id } = await params;
    run = saasEnabled()
      ? await withTenantSession(saasDatabase(), (await cookies()).get(SAAS_SESSION_COOKIE)?.value, () => getTenantRun(id))
      : getRun(id);
  } catch {
    notFound();
  }
  return (
    <main className="flows-main">
      <a href="/historico">Voltar às execuções</a>
      <RunView run={run} />
    </main>
  );
}
