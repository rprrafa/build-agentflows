import { TelaCriarConta } from "@/components/conta";
import { SaasAccount } from "@/components/SaasAccount";
import { saasEnabled } from "@/lib/tenant-context";
export const dynamic = "force-dynamic";

export default function Page() {
  if (saasEnabled()) return <SaasAccount mode="register" google={!!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)} />;
  return <TelaCriarConta marca="B" nome="Build Agentflows" />;
}
