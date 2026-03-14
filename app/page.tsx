export default function Home() {
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-6 text-center">
      <h1 className="text-4xl sm:text-6xl font-bold tracking-tight mb-4">
        vread<span className="text-neutral-500">.me</span>
      </h1>
      <p className="text-neutral-500 text-lg sm:text-xl max-w-md mb-10 leading-relaxed">
        Paste a link or upload a PDF.<br />
        Listen in seconds.
      </p>
      <a
        href="/read"
        className="bg-white hover:bg-neutral-200 text-neutral-950 font-medium px-8 py-4 rounded-xl text-lg transition-colors"
      >
        Get started
      </a>
    </main>
  );
}
