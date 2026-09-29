// O resolvedor em si (ver scripts/gancho-ts.mjs). Roda na thread de carregamento do Node.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RAIZ = process.cwd();

export function resolve(especificador, contexto, proximo) {
  // O atalho `@/` do tsconfig aponta para a raiz do app.
  if (especificador.startsWith("@/")) {
    const base = path.join(RAIZ, especificador.slice(2));
    const arquivo = !path.extname(base) && existsSync(`${base}.ts`) ? `${base}.ts` : base;
    return proximo(pathToFileURL(arquivo).href, contexto);
  }

  // Import relativo sem extensão: `./candidatos` → `./candidatos.ts`.
  if (especificador.startsWith(".") && !path.extname(especificador)) {
    const base = contexto.parentURL ? path.dirname(fileURLToPath(contexto.parentURL)) : RAIZ;
    for (const tentativa of [`${especificador}.ts`, `${especificador}/index.ts`]) {
      if (existsSync(path.resolve(base, tentativa))) return proximo(tentativa, contexto);
    }
  }

  return proximo(especificador, contexto);
}
