import { criar, listar, motivoCanalIndisponivel, validarParametrosTipo, type Frequencia } from "@/lib/rotinas";
import { TIPOS_ROTINA } from "@/lib/rotinas-do-app";
import { enderecoPublico, registrarEnderecoPublico } from "@/lib/setup-comum";
import { getConfig } from "@/lib/store";

const FREQUENCIAS: Frequencia[] = ["diaria", "semanal", "mensal", "unica"];
const HORA_VALIDA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Lista as rotinas cadastradas e os tipos disponíveis (cartão "Rotinas" em /setup). */
export async function GET() {
  return Response.json({
    itens: listar(),
    tipos: TIPOS_ROTINA,
    destinoPadrao: getConfig("NOTIFICACOES_DESTINO") || "",
    enderecoPublicoDesconhecido: !enderecoPublico(),
  });
}

export async function POST(req: Request) {
  registrarEnderecoPublico(req);
  const corpo = await req.json().catch(() => null);
  const tipo = typeof corpo?.tipo === "string" ? corpo.tipo : "";
  const frequencia = corpo?.frequencia as Frequencia;
  const hora = typeof corpo?.hora === "string" ? corpo.hora : "";
  const canal = corpo?.canal === "slack" ? "slack" : "email";
  const destino = typeof corpo?.destino === "string" && corpo.destino.trim() ? corpo.destino.trim() : undefined;

  if (!TIPOS_ROTINA.some((t) => t.tipo === tipo)) return Response.json({ error: "Escolha o que a rotina deve fazer." }, { status: 400 });
  if (!FREQUENCIAS.includes(frequencia)) return Response.json({ error: "Escolha a frequência." }, { status: 400 });
  if (!HORA_VALIDA.test(hora)) return Response.json({ error: "Informe um horário válido." }, { status: 400 });

  let diaSemana: number | undefined;
  let diaMes: number | undefined;
  let dataUnica: string | undefined;

  if (frequencia === "semanal") {
    diaSemana = Number(corpo?.diaSemana);
    if (!Number.isInteger(diaSemana) || diaSemana < 0 || diaSemana > 6) return Response.json({ error: "Escolha o dia da semana." }, { status: 400 });
  }
  if (frequencia === "mensal") {
    diaMes = Number(corpo?.diaMes);
    if (!Number.isInteger(diaMes) || diaMes < 1 || diaMes > 31) return Response.json({ error: "Escolha o dia do mês (1 a 31)." }, { status: 400 });
  }
  if (frequencia === "unica") {
    const bruta = typeof corpo?.dataUnica === "string" ? corpo.dataUnica : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bruta)) return Response.json({ error: "Escolha a data." }, { status: 400 });
    dataUnica = bruta;
  }
  if (canal === "email" && !destino && !getConfig("NOTIFICACOES_DESTINO")) {
    return Response.json({ error: "Informe o e-mail de destino." }, { status: 400 });
  }

  // parametros: dados específicos do tipo de rotina (ex.: o perfil buscado de uma rotina de leads),
  // enviados por um botão próprio do app; a maioria dos tipos não precisa e omite o campo.
  const parametrosBrutos = corpo?.parametros;
  const parametros = parametrosBrutos && typeof parametrosBrutos === "object" && !Array.isArray(parametrosBrutos) ? parametrosBrutos : {};

  const motivoCanal = motivoCanalIndisponivel(canal);
  if (motivoCanal) return Response.json({ error: motivoCanal, motivo: "notificacoes" }, { status: 400 });
  const motivoParametros = validarParametrosTipo(tipo, parametros, TIPOS_ROTINA);
  if (motivoParametros) return Response.json({ error: motivoParametros }, { status: 400 });

  const id = criar({ tipo, frequencia, hora, diaSemana, diaMes, dataUnica, canal, destino, parametros });
  return Response.json({ id });
}
