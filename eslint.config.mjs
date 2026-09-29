import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // window.alert interrompe a tela com um popup do navegador, sem lugar para uma ação; use o
      // componente Aviso (components/ui.tsx) no lugar certo da tela. window.confirm continua permitido
      // (só é convenção de uso: reservado para "Apagar tudo"; qualquer outra confirmação usa useConfirmacao()).
      "no-restricted-globals": ["error", { name: "alert", message: "Use o componente Aviso (components/ui.tsx) em vez de window.alert." }],
    },
  },
]);

export default eslintConfig;
