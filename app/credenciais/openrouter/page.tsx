"use client";
import { useEffect } from "react";
export default function OpenRouterComplete() {
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    if (window.opener) {
      window.opener.postMessage({ type: "openrouter-connected", credentialId: query.get("credentialId"), error: query.get("erro") }, location.origin);
      window.close();
    }
  }, []);
  return <main className="library-page"><h1>Conexão OpenRouter</h1><p>A autorização foi processada. Você pode fechar esta janela e retornar ao editor.</p><a href="/credenciais">Voltar para Credenciais</a></main>;
}
