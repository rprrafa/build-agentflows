// Tela pública mínima de um formulário (sem Topbar completa): marca do app, título, campos e "Enviar".
// Copie este arquivo (e FormularioPublico.tsx) para cada app sem alterar; o conteúdo vem inteiro do
// que o app gravou em lib/formularios.ts (criar).
import type { ParametrosPublicos } from "@/lib/formularios";
import { expirou, obter, listarRespostas } from "@/lib/formularios";
import { FormularioPublico } from "./FormularioPublico";

export const dynamic = "force-dynamic";

function Indisponivel({ titulo, descricao }: { titulo: string; descricao: string }) {
  return (
    <main className="min-h-[70vh] flex flex-col items-center justify-center text-center gap-3 px-6">
      <h1 className="text-2xl font-extrabold">{titulo}</h1>
      <p className="text-muted max-w-[420px]">{descricao}</p>
    </main>
  );
}

export default async function Page({ params }: PageProps<"/f/[token]">) {
  const { token } = await params;
  const formulario = obter<ParametrosPublicos>(token);

  if (!formulario) {
    return <Indisponivel titulo="Este link não existe" descricao="Confira se o endereço foi copiado corretamente, ou peça um novo link a quem enviou este formulário." />;
  }

  if (expirou(formulario)) {
    return <Indisponivel titulo="Este link expirou" descricao="Peça um novo link a quem enviou este formulário." />;
  }

  const noLimite = formulario.limite !== null && listarRespostas(token).length >= formulario.limite;
  if (noLimite) {
    return <Indisponivel titulo="Este formulário não recebe mais respostas" descricao="O limite de respostas deste link já foi atingido." />;
  }

  const { marca, nome, titulo, descricao, agradecimento } = formulario.parametros;
  return <FormularioPublico token={token} marca={marca} nome={nome} titulo={titulo} descricao={descricao} agradecimento={agradecimento} campos={formulario.campos} />;
}
