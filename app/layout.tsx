import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "vread.me — Escucha cualquier documento",
  description: "Convierte documentos y páginas web en audio hablado en español. Pega un link o sube un PDF y empieza a escuchar en segundos.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="bg-neutral-950 text-neutral-200">{children}</body>
    </html>
  );
}
