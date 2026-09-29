import { apagar, pausar } from "@/lib/rotinas";

export async function PATCH(req: Request, { params }: RouteContext<"/api/rotinas/[id]">) {
  const { id } = await params;
  const corpo = await req.json().catch(() => null);
  if (typeof corpo?.ativa !== "boolean") return Response.json({ error: "Informe o novo estado da rotina." }, { status: 400 });
  pausar(id, corpo.ativa);
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: RouteContext<"/api/rotinas/[id]">) {
  const { id } = await params;
  apagar(id);
  return Response.json({ ok: true });
}
