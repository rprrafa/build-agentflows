import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-[70vh] flex flex-col items-center justify-center text-center gap-3 px-6">
      <h1 className="text-2xl font-extrabold">Este link não existe mais</h1>
      <p className="text-muted max-w-[420px]">O resultado pode ter expirado ou o endereço está incorreto. Execute um fluxo para continuar.</p>
      <Link href="/" className="btn-primary mt-2">Voltar para o início</Link>
    </main>
  );
}
