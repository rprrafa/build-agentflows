import { salvarCampos, statusConexoes } from "@/lib/conexoes";
import { appOrigin } from "@/lib/saas-security";
import { requestApi, body } from "@/lib/flow-api";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  return requestApi(req, () => statusConexoes(appOrigin()));
}
export async function PUT(req: Request) {
  return requestApi(req, async () => {
    const b = await body(req);
    const campos = b.campos as Record<string, unknown> | undefined;
    salvarCampos(campos, b.aceiteWhatsApp);
    // Ao salvar o WhatsApp, o endereço de avisos é cadastrado no provedor (Z-API e ZapperHub).
    let aviso: string | null = null;
    if (campos && Object.keys(campos).some((k) => /^(WHATSAPP_|ZAPI_|ZAPPERHUB_)/.test(k))) {
      const { configurarAvisos } = await import("@/lib/whatsapp");
      const { whatsappConfigurado } = await import("@/lib/conexoes");
      if (whatsappConfigurado())
        aviso = await configurarAvisos(appOrigin()).then(
          (endereco) => (endereco ? "Endereço de avisos cadastrado no provedor." : null),
          (err: Error) => `Credenciais salvas, mas o provedor não aceitou o endereço de avisos: ${err.message}`,
        );
    }
    return { ...(await statusConexoes(appOrigin())), aviso };
  });
}
