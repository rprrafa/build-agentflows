import { notFound } from "next/navigation";
import { EmbedChat } from "@/components/EmbedChat";
import { withEmbedOwner } from "@/lib/embed-http";
import { getFlow } from "@/lib/flow-service";
import { embedSettings, hasEmbedKey } from "@/lib/embed-store";
export const dynamic = "force-dynamic";
export default async function EmbedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let settings;
  try { settings = await withEmbedOwner(id, async () => { if (!(await getFlow(id)).published || !hasEmbedKey(id)) notFound(); return embedSettings(id); }); } catch { notFound(); }
  if (!settings.enabled) notFound();
  return <EmbedChat agentName={settings.agentName || "Assistente"} avatarUrl={settings.avatarUrl || ""} title={settings.title} welcome={settings.welcome}/>;
}
