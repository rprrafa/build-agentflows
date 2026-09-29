// Regras de conta sem nenhum import node:* — pode ser chamado tanto do servidor (lib/conta.ts)
// quanto de um Client Component (components/conta.tsx). Copie sem alterar ao replicar.

/** Regra da senha, na mesma frase que aparece na tela. */
export const REGRA_SENHA = "Mínimo de 8 caracteres, com letra maiúscula, minúscula, número e caractere especial.";

const ESPECIAL = /[^\p{L}\p{N}]/u;

export function senhaFraca(senha: string): string | null {
  if (senha.length < 8) return REGRA_SENHA;
  if (!/\p{Ll}/u.test(senha)) return REGRA_SENHA;
  if (!/\p{Lu}/u.test(senha)) return REGRA_SENHA;
  if (!/\p{N}/u.test(senha)) return REGRA_SENHA;
  if (!ESPECIAL.test(senha)) return REGRA_SENHA;
  return null;
}

/** Força de 0 a 4 para o medidor de quatro barras da tela de criar conta. */
export type Forca = { nivel: 0 | 1 | 2 | 3 | 4; rotulo: string };

export function forcaSenha(senha: string): Forca {
  if (!senha) return { nivel: 0, rotulo: "" };
  let pontos = 0;
  if (senha.length >= 8) pontos++;
  if (senha.length >= 12) pontos++;
  if (/\p{Ll}/u.test(senha) && /\p{Lu}/u.test(senha)) pontos++;
  if (/\p{N}/u.test(senha)) pontos++;
  if (ESPECIAL.test(senha)) pontos++;
  // Senha que ainda não cumpre a regra nunca passa de "razoável", para o medidor não
  // dizer "forte" enquanto o botão está bloqueado.
  const teto = senhaFraca(senha) ? 2 : 4;
  const nivel = Math.min(Math.max(pontos - 1, 1), teto) as 1 | 2 | 3 | 4;
  return { nivel, rotulo: ["", "Senha fraca", "Senha razoável", "Senha boa", "Senha forte"][nivel] };
}

export function emailInvalido(email: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "Escreva um e-mail válido, como voce@empresa.com.";
  return null;
}
