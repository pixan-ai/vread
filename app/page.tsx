"use client";

import { useEffect, useRef } from "react";

type Particle = { tx: number; ty: number; wx: number; wy: number };

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let particles: Particle[] = [];
    let w = 0;
    let h = 0;
    let pSize = 1.5;

    function init() {
      const dpr = window.devicePixelRatio || 1;
      w = window.innerWidth;
      h = Math.max(160, window.innerHeight * 0.3);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      const oc = off.getContext("2d")!;
      const fontSize = Math.min(w * 0.11, 120);
      pSize = Math.max(1.2, fontSize / 50);
      const gap = pSize + 0.8;

      oc.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
      oc.fillStyle = "#fff";
      oc.textAlign = "center";
      oc.textBaseline = "middle";
      oc.fillText("vread.me", w / 2, h / 2);

      const img = oc.getImageData(0, 0, w, h);
      particles = [];

      for (let y = 0; y < h; y += gap) {
        for (let x = 0; x < w; x += gap) {
          const ix = Math.round(x);
          const iy = Math.round(y);
          if (img.data[(iy * w + ix) * 4 + 3] > 128) {
            // Waveform: multi-frequency sine for organic feel
            const nx = x / w;
            const wy =
              h / 2 +
              Math.sin(nx * Math.PI * 4) * h * 0.12 +
              Math.sin(nx * Math.PI * 7 + 1.2) * h * 0.06 +
              Math.sin(nx * Math.PI * 13 + 0.5) * h * 0.03;
            particles.push({ tx: x, ty: y, wx: x, wy });
          }
        }
      }
    }

    init();
    window.addEventListener("resize", init);

    let raf: number;

    function draw(t: number) {
      ctx.clearRect(0, 0, w, h);

      // 8-second cycle: text(3s) → morph(1s) → wave(3s) → morph back(1s)
      const cycle = (t % 8000) / 8000;
      let mix: number;
      if (cycle < 0.375) mix = 0; // text hold
      else if (cycle < 0.5) mix = (cycle - 0.375) / 0.125; // morph to wave
      else if (cycle < 0.875) mix = 1; // wave hold
      else mix = 1 - (cycle - 0.875) / 0.125; // morph to text

      // Smooth ease (smoothstep)
      mix = mix * mix * (3 - 2 * mix);

      for (const p of particles) {
        const x = p.tx + (p.wx - p.tx) * mix;
        let y = p.ty + (p.wy - p.ty) * mix;

        // Living wave movement when morphed
        if (mix > 0.01) {
          const wave =
            Math.sin(p.wx * 0.015 + t * 0.002) * 8 +
            Math.sin(p.wx * 0.008 + t * 0.0035) * 5;
          y += wave * mix;
        }

        // Subtle glow: particles near center are brighter
        const distFromCenter = Math.abs(y - h / 2) / (h * 0.3);
        const alpha = mix > 0.01
          ? Math.max(0.3, 1 - distFromCenter * 0.6 * mix)
          : 0.95;

        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.beginPath();
        ctx.arc(x, y, pSize * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    }

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", init);
    };
  }, []);

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center overflow-hidden">
      <canvas ref={canvasRef} className="mb-2" />
      <p className="text-neutral-500 text-lg sm:text-xl max-w-md text-center mb-10 leading-relaxed px-6">
        Paste a link or upload a PDF.
        <br />
        Listen in seconds.
      </p>
      <a
        href="/read"
        className="bg-white hover:bg-neutral-200 text-neutral-950 font-medium px-8 py-4 rounded-xl text-lg transition-colors active:scale-[0.98]"
      >
        Get started
      </a>
    </main>
  );
}
