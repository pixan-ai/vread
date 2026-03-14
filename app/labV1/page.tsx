"use client";

import { useEffect, useRef } from "react";

type Particle = { tx: number; ty: number; wx: number; wy: number };

export default function LabV1() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let particles: Particle[] = [];
    let w = 0, h = 0, pSize = 2;

    function init() {
      const dpr = window.devicePixelRatio || 1;
      w = window.innerWidth;
      h = Math.max(200, window.innerHeight * 0.4);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Draw text offscreen to sample pixel positions
      const off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      const oc = off.getContext("2d")!;
      const fontSize = Math.min(w * 0.13, 140);
      pSize = Math.max(2, Math.round(fontSize / 35));
      const gap = pSize + 1;

      oc.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`;
      oc.fillStyle = "#fff";
      oc.textAlign = "center";
      oc.textBaseline = "middle";
      oc.fillText("vread.me", w / 2, h / 2);

      const img = oc.getImageData(0, 0, w, h);
      particles = [];

      for (let y = 0; y < h; y += gap) {
        for (let x = 0; x < w; x += gap) {
          if (img.data[(y * w + x) * 4 + 3] > 128) {
            particles.push({
              tx: x,
              ty: y,
              wx: x,
              wy: h / 2 + Math.sin((x / w) * Math.PI * 3.5) * h * 0.18,
            });
          }
        }
      }
    }

    init();
    window.addEventListener("resize", init);

    let raf: number;
    function draw(t: number) {
      ctx.clearRect(0, 0, w, h);

      // 6-second cycle: text → morph → wave → morph → text
      const cycle = (t % 6000) / 6000;
      let mix: number;
      if (cycle < 0.25) mix = 0;
      else if (cycle < 0.35) mix = (cycle - 0.25) / 0.1;
      else if (cycle < 0.65) mix = 1;
      else if (cycle < 0.75) mix = 1 - (cycle - 0.65) / 0.1;
      else mix = 0;

      // Smoothstep easing
      mix = mix * mix * (3 - 2 * mix);

      for (const p of particles) {
        const x = p.tx + (p.wx - p.tx) * mix;
        let y = p.ty + (p.wy - p.ty) * mix;

        // Living wave: particles drift when morphed
        if (mix > 0) {
          y += Math.sin(p.wx * 0.018 + t * 0.0025) * 14 * mix;
        }

        // Color: neutral-200 → indigo-500
        ctx.fillStyle = `rgb(${Math.round(229 - 130 * mix)},${Math.round(229 - 127 * mix)},${Math.round(229 + 12 * mix)})`;
        ctx.fillRect(x, y, pSize, pSize);
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
    <main className="min-h-dvh flex flex-col items-center justify-center bg-neutral-950 overflow-hidden">
      <canvas ref={canvasRef} />
      <div className="text-center mt-6">
        <p className="text-neutral-400 text-lg sm:text-xl mb-10 leading-relaxed">
          Pega un link. Escucha en segundos.
        </p>
        <a
          href="/read"
          className="bg-indigo-500 hover:bg-indigo-400 text-white font-medium px-8 py-4 rounded-xl text-lg transition-colors"
        >
          Comenzar
        </a>
      </div>
    </main>
  );
}
