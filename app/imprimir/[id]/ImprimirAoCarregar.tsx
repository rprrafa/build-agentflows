"use client";

import { useEffect } from "react";

/** Aciona o diálogo de impressão assim que a folha termina de montar. */
export function ImprimirAoCarregar() {
  useEffect(() => {
    window.print();
  }, []);
  return null;
}
