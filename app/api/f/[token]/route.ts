// Recebe a resposta de um formulário público (app/f/[token]) e chama o callback que o app registrou
// para esse tipo (lib/formularios.ts: registrarCallback/obterCallback), que pode gerar um resultado.
// Ao contrário de lib/formularios.ts e app/f/[token]/page.tsx, este arquivo NÃO é copiado sem alterar:
// cada app pode precisar importar seu próprio módulo (ex.: lib/pdi.ts) para garantir que o callback
// já esteja registrado quando a rota carrega.
import { NextResponse } from "next/server";
import { obter, obterCallback, responder } from "@/lib/formularios";



export async function POST(request: Request, { params }: RouteContext<"/api/f/[token]">) {
  const { token } = await params;
  const formulario = obter(token);
  if (!formulario) {
    return NextResponse.json({ error: "Link inválido." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const body = await request.json().catch(() => null);

  // Honeypot: uma pessoa nunca preenche este campo (fica invisível na tela); um bot que preenche tudo, sim.
  // Finge sucesso sem gravar nada, para não dar sinal ao bot de que foi identificado.
  if (typeof body?.armadilha === "string" && body.armadilha.trim()) {
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  }

  const dados: Record<string, string> = {};
  for (const campo of formulario.campos) {
    const bruto = typeof body?.dados?.[campo.chave] === "string" ? body.dados[campo.chave] : "";
    const valor = bruto.slice(0, 4000).trim();
    if (campo.obrigatorio && !valor) {
      return NextResponse.json({ error: `Preencha "${campo.rotulo}".` }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    if (campo.tipo === "escala" && valor) {
      const min = campo.min ?? 1;
      const max = campo.max ?? 5;
      const n = Number(valor);
      if (!Number.isFinite(n) || n < min || n > max) {
        return NextResponse.json({ error: `Escolha um valor entre ${min} e ${max} para "${campo.rotulo}".` }, { status: 400, headers: { "Cache-Control": "no-store" } });
      }
    }
    if (campo.tipo === "escolha" && valor) {
      const validos = new Set((campo.opcoes ?? []).map((o) => o.valor));
      const escolhidos: string[] = campo.multipla ? valor.split(",") : [valor];
      if (escolhidos.some((v) => !validos.has(v))) {
        return NextResponse.json({ error: `Escolha uma opção válida para "${campo.rotulo}".` }, { status: 400, headers: { "Cache-Control": "no-store" } });
      }
    }
    dados[campo.chave] = valor;
  }

  let resultadoId: string | undefined;
  const callback = obterCallback(formulario.tipo);
  if (callback) {
    try {
      const resultado = await callback({ token, dados, parametros: formulario.parametros });
      resultadoId = resultado?.resultadoId;
    } catch (err) {
      console.error("Falha ao executar o callback do formulário", formulario.tipo, err);
    }
  }

  const resultado = responder(token, dados, resultadoId);
  if (!resultado.ok) {
    const mensagem = resultado.motivo === "expirado" ? "Este link expirou." : resultado.motivo === "limite" ? "Este formulário atingiu o limite de respostas." : "Link inválido.";
    return NextResponse.json({ error: mensagem }, { status: 410, headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
