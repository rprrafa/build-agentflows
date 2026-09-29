import { falar } from "@/lib/elevenlabs";
import { FlowError } from "@/lib/flow-store";
import { body } from "@/lib/flow-api";
export async function POST(req: Request) {
  try {
    const b = await body(req);
    if (typeof b.texto !== "string") throw new FlowError("Envie o texto a falar.");
    return new Response(await falar(b.texto, typeof b.voz === "string" ? b.voz : undefined, req.signal), {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Não foi possível gerar a fala." },
      { status: e instanceof FlowError ? e.status : 500 },
    );
  }
}
