"use client";
export function WhatsAppTerms({ provider, acceptance, checked, onChange }: {
  provider: string;
  acceptance?: { versao: string; provedor: string; data: string } | null;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  if (!["zapi", "zapperhub"].includes(provider)) return null;
  const accepted = acceptance?.provedor === provider && acceptance.versao === "2026-09-20";
  return <section className="whatsapp-terms" aria-label="Termos de uso e responsabilidade">
    <h3>Termos de uso e responsabilidade</h3>
    <p>Ao aceitar, você reconhece que está ciente dos riscos associados ao uso de uma API não oficial do WhatsApp. O uso indevido pode resultar em penalidades, incluindo o bloqueio permanente do seu número pela Meta.</p>
    <p>Você assume total responsabilidade pela forma como a API será usada. A StartSe exime-se de responsabilidade por sanções, bloqueios ou outros impactos negativos decorrentes da utilização do serviço {provider === "zapi" ? "Z-API" : "ZapperHub"}, sendo o utilizador responsável pelas consequências da sua utilização.</p>
    {accepted ? <small>Aceite registrado em {new Date(acceptance.data).toLocaleString("pt-BR")}.</small> :
      <label className="terms-check"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />Li e aceito os termos de uso e responsabilidade.</label>}
  </section>;
}
