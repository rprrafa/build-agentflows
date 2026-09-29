import { KnowledgeWorkspace } from "@/components/KnowledgeWorkspace";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <KnowledgeWorkspace id={(await params).id} />;
}
