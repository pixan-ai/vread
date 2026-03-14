"use client";

import { useState, useEffect, useRef, useCallback } from "react";

const SAMPLE_TEXT =
  "La inteligencia artificial está transformando la manera en que consumimos información. Documentos largos, artículos técnicos y reportes que antes requerían horas de lectura, ahora pueden convertirse en audio de alta calidad en cuestión de segundos. Solo necesitas un enlace.";

function getWordDelay(word: string): number {
  if (/[.,;:]$/.test(word)) return 320;
  if (/[.!?]$/.test(word)) return 500;
  return 100 + word.length * 12;
}

export default function LabV2() {
  const words = SAMPLE_TEXT.split(" ");
  const [active, setActive] = useState(-1);
  const [bars, setBars] = useState<number[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const totalBars = 48;

  const advance = useCallback(
    (index: number) => {
      if (index >= words.length) {
        timerRef.current = setTimeout(() => {
          setActive(-1);
          setBars([]);
          timerRef.current = setTimeout(() => advance(0), 800);
        }, 2500);
        return;
      }

      setActive(index);

      const target = Math.ceil(((index + 1) / words.length) * totalBars);
      setBars((prev) => {
        const next = [...prev];
        while (next.length < target) {
          next.push(0.25 + Math.random() * 0.75);
        }
        return next;
      });

      timerRef.current = setTimeout(() => advance(index + 1), getWordDelay(words[index]));
    },
    [words]
  );

  useEffect(() => {
    timerRef.current = setTimeout(() => advance(0), 1200);
    return () => clearTimeout(timerRef.current);
  }, [advance]);

  return (
    <>
      <style>{`
        @keyframes bar-breathe {
          0%, 100% { transform: scaleY(1); }
          50% { transform: scaleY(0.6); }
        }
      `}</style>

      <main className="min-h-dvh flex flex-col items-center justify-center px-6 bg-neutral-950 overflow-hidden">
        <div className="max-w-2xl w-full">
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight mb-16 text-center">
            vread<span className="text-neutral-500">.me</span>
          </h1>

          <div className="text-lg sm:text-xl leading-relaxed mb-14 min-h-[140px]">
            {words.map((word, i) => {
              const consumed = i < active;
              const current = i === active;
              const next = i === active + 1;

              return (
                <span
                  key={i}
                  className="inline-block mr-[0.3em] transition-all duration-300 ease-out"
                  style={{
                    opacity: consumed ? 0 : current ? 1 : next ? 0.9 : 0.6,
                    transform: consumed
                      ? "scale(0.85) translateY(-6px)"
                      : current
                        ? "scale(1.02)"
                        : "none",
                    color: current ? "#fff" : "#a3a3a3",
                    textShadow: current ? "0 0 20px rgba(255,255,255,0.25)" : "none",
                  }}
                >
                  {word}
                </span>
              );
            })}
          </div>

          <div className="flex items-end justify-center gap-[3px] h-24 mb-16">
            {bars.map((amp, i) => (
              <div
                key={i}
                className="w-1.5 sm:w-2 rounded-full bg-white origin-bottom"
                style={{
                  height: `${amp * 100}%`,
                  opacity: 0.4 + amp * 0.6,
                  animation: "bar-breathe 1.8s ease-in-out infinite",
                  animationDelay: `${i * 60}ms`,
                  transition: "height 0.4s ease-out",
                }}
              />
            ))}
          </div>

          <div className="text-center">
            <a
              href="/read"
              className="bg-white hover:bg-neutral-200 text-neutral-950 font-medium px-8 py-4 rounded-xl text-lg transition-colors"
            >
              Comenzar
            </a>
          </div>
        </div>
      </main>
    </>
  );
}
