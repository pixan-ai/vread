import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-6 text-center">
      <h1 className="text-4xl sm:text-6xl font-bold tracking-tight mb-4">
        vread<span className="text-[var(--accent)]">.me</span>
      </h1>
      <p className="text-[var(--text-muted)] text-lg sm:text-xl max-w-md mb-10 leading-relaxed">
        Pega un link o sube un PDF.<br />
        Escucha en segundos.
      </p>
      <Link
        href="/read"
        className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-medium px-8 py-4 rounded-xl text-lg transition-colors"
      >
        Comenzar
      </Link>
    </main>
  );
}
