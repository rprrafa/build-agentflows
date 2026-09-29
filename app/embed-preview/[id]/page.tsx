import { getFlow } from "@/lib/flow-service";
import { cookies } from "next/headers";
import { withTenantSession } from "@/lib/tenant-context";
import { saasDatabase } from "@/lib/saas-db";
import { SAAS_SESSION_COOKIE } from "@/lib/saas-auth";
import { EmbedPreview } from "@/components/EmbedPreview";
import { notFound } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function EmbedPreviewPage({params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  let flow;
  try {flow=await withTenantSession(saasDatabase(), (await cookies()).get(SAAS_SESSION_COOKIE)?.value, () => getFlow(id));}catch{notFound();}
  return <EmbedPreview flowId={id} flowName={flow.name}/>;
}
