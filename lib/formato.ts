/** Helpers de formatação pt-BR. Arquivo sem "use client": pode ser chamado tanto de Server quanto de Client Components. */

/** Formata número no padrão pt-BR (vírgula decimal), com `casas` dígitos após a vírgula. */
export function numero(n: number, casas = 0) {
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(n);
}

/** Formata data no padrão pt-BR; inclui o ano quando `comAno` ou fora do ano corrente, e a hora quando `comHora`. */
export function data(d: Date | string, { comHora = false, comAno = false }: { comHora?: boolean; comAno?: boolean } = {}) {
  const dt = typeof d === "string" ? new Date(d) : d;
  const opcoes: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit" };
  if (comAno || dt.getFullYear() !== new Date().getFullYear()) opcoes.year = "numeric";
  let texto = new Intl.DateTimeFormat("pt-BR", opcoes).format(dt);
  if (comHora) texto += ` às ${new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(dt)}`;
  return texto;
}
