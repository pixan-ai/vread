export default function Home() {
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-6 text-center">
      <h1 className="text-4xl sm:text-6xl font-bold tracking-tight mb-4">
        vread<span className="text-indigo-500">.me</span>
      </h1>
      <p className="text-neutral-400 text-lg sm:text-xl max-w-md mb-10 leading-relaxed">
        Pega un link o sube un PDF.<br />
        Escucha en segundos.
      </p>
      <a
        href="/read"
        className="bg-indigo-500 hover:bg-indigo-400 text-white font-medium px-8 py-4 rounded-xl text-lg transition-colors"
      >
        Comenzar
      </a>
    </main>
  );
}
