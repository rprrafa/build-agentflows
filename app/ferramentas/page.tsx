import Link from "next/link";
import { ToolServers } from "@/components/ToolServers";
export default async function Page({ searchParams }: { searchParams: Promise<{ erro?: string; conectado?: string }> }) {
  const q = await searchParams;
  return <main className="library-page connections-page"><h1>Ferramentas dos agentes</h1><p>Volte à aba do Agente para escolher as ferramentas autorizadas.</p>{q.erro && <p role="alert" className="studio-error">{q.erro}</p>}{q.conectado && <p role="status">Servidor autorizado. Volte ao Agente para atualizar a seleção.</p>}<ToolServers /><Link href="/">Voltar aos fluxos</Link></main>;
}
