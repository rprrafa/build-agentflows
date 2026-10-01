import { FlowError } from "./flow-store";
export function providerFailure(status: number) {
  const message = status === 401 || status === 403 ? "O fornecedor recusou a chave. Revise a conexão em Credenciais."
    : status === 402 ? "Sua conta no fornecedor está sem saldo para este modelo."
    : status === 429 ? "O fornecedor atingiu o limite de uso. Aguarde ou escolha outro modelo."
    : status === 404 ? "Este modelo não está disponível para a credencial selecionada."
    : status === 400 ? "O fornecedor recusou os parâmetros ou a mensagem. Revise as configurações do modelo."
    : "O fornecedor está indisponível. Tente novamente em alguns instantes.";
  return new FlowError(message, status >= 400 && status < 500 ? status : 502);
}
