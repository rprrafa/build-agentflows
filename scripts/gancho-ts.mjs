// Gancho de resolução para rodar os `lib/*.ts` deste app fora do Next (`node --test`).
//
// O Node 24 já apaga os tipos sozinho, mas não sabe duas coisas que o Next resolve por nós:
// o import relativo sem extensão (`./candidatos`) e o atalho `@/` do `tsconfig.json`. São ~20 linhas,
// e com elas o teste exercita o código de verdade em vez de uma cópia dele.
//
// Uso: `npm test` (ou `node --import ./scripts/gancho-ts.mjs --test lib/*.test.ts`).
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(new URL("./resolvedor-ts.mjs", import.meta.url), pathToFileURL("./"));
