"use client";

import { useState, useRef } from "react";

type ChunkInfo = { url: string; duration: number };

export default function ReadPage() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "processing" | "playing" | "error">("idle");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [rate, setRate] = useState(1);
  const [hasAudio, setHasAudio] = useState(false);

  const chunks = useRef<ChunkInfo[]>([]);
  const buffers = useRef<ArrayBuffer[]>([]);
  const audio = useRef<HTMLAudioElement | null>(null);
  const rateRef = useRef(1);
  const waiting = useRef(false);
  const done = useRef(false);
  const idx = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const RATES = [1, 1.25, 1.5, 2] as const;

  // --- Audio engine: sequential chunk playback ---

  function elapsed(i: number) {
    let t = 0;
    for (let j = 0; j < i; j++) t += chunks.current[j].duration;
    return t;
  }

  function totalDur() {
    let t = 0;
    for (const c of chunks.current) t += c.duration;
    return t;
  }

  function playAt(index: number, seekTo = 0) {
    if (index >= chunks.current.length) {
      if (done.current) setPlaying(false);
      else waiting.current = true;
      return;
    }

    waiting.current = false;
    idx.current = index;
    audio.current?.pause();

    const el = new Audio(chunks.current[index].url);
    el.playbackRate = rateRef.current;
    el.ontimeupdate = () => setTime(elapsed(idx.current) + el.currentTime);
    el.onloadedmetadata = () => {
      chunks.current[index].duration = el.duration;
      setDur(totalDur());
      el.currentTime = seekTo;
      el.play().catch(() => {});
    };
    el.onended = () => playAt(index + 1);

    audio.current = el;
    setPlaying(true);
  }

  function addChunk(buffer: ArrayBuffer) {
    buffers.current.push(buffer);
    const blob = new Blob([buffer], { type: "audio/mpeg" });
    const chunkUrl = URL.createObjectURL(blob);
    const i = chunks.current.length;
    chunks.current.push({ url: chunkUrl, duration: 0 });

    const probe = new Audio(chunkUrl);
    probe.onloadedmetadata = () => {
      if (chunks.current[i]) {
        chunks.current[i].duration = probe.duration;
        setDur(totalDur());
      }
    };

    if (i === 0) {
      setHasAudio(true);
      setStatus("playing");
      playAt(0);
    } else if (waiting.current) {
      playAt(i);
    }
  }

  function cleanup() {
    audio.current?.pause();
    chunks.current.forEach((c) => URL.revokeObjectURL(c.url));
    chunks.current = [];
    buffers.current = [];
    idx.current = 0;
    waiting.current = false;
    done.current = false;
  }

  // --- Conversion ---

  async function convert(body: BodyInit, headers: Record<string, string> = {}) {
    cleanup();
    setStatus("processing");
    setMessage("Conectando...");
    setProgress(0);
    setError("");
    setHasAudio(false);

    try {
      const res = await fetch("/api/convert", { method: "POST", headers, body });
      if (!res.ok || !res.body) throw new Error(`Error del servidor: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;

          let evt: { type: string; message?: string; progress?: number; data?: string };
          try {
            evt = JSON.parse(line.slice(6));
          } catch {
            continue;
          }

          if (evt.type === "status") {
            setMessage(evt.message || "");
            setProgress(evt.progress || 0);
          } else if (evt.type === "audio_chunk" && evt.data) {
            const raw = atob(evt.data);
            const bytes = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
            addChunk(bytes.buffer);
          } else if (evt.type === "complete") {
            done.current = true;
            setMessage("Listo");
            setProgress(100);
          } else if (evt.type === "error") {
            throw new Error(evt.message || "Error desconocido");
          }
        }
      }
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Error desconocido");
    }
  }

  // --- Handlers ---

  function submit() {
    if (!url.trim()) return;
    convert(JSON.stringify({ url: url.trim() }), { "Content-Type": "application/json" });
  }

  function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    convert(fd);
  }

  function togglePlay() {
    if (!audio.current) return;
    if (audio.current.paused) {
      audio.current.play();
      setPlaying(true);
    } else {
      audio.current.pause();
      setPlaying(false);
    }
  }

  function seek(e: React.ChangeEvent<HTMLInputElement>) {
    const t = parseFloat(e.target.value);
    let cum = 0;
    for (let i = 0; i < chunks.current.length; i++) {
      if (cum + chunks.current[i].duration > t || i === chunks.current.length - 1) {
        playAt(i, Math.max(0, t - cum));
        return;
      }
      cum += chunks.current[i].duration;
    }
  }

  function cycleRate() {
    const next = RATES[(RATES.indexOf(rateRef.current as (typeof RATES)[number]) + 1) % RATES.length];
    rateRef.current = next;
    setRate(next);
    if (audio.current) audio.current.playbackRate = next;
  }

  function download() {
    if (!buffers.current.length) return;
    const blob = new Blob(buffers.current, { type: "audio/mpeg" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "vread-audio.mp3";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function fmt(s: number) {
    return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
  }

  // --- UI ---

  return (
    <main className="min-h-dvh flex flex-col px-4 sm:px-6 pt-12 pb-48 max-w-2xl mx-auto">
      <a href="/" className="text-xl font-bold mb-10 inline-block">
        vread<span className="text-neutral-500">.me</span>
      </a>

      <div className="space-y-3">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Pega un link (web, PDF, Google Doc)"
          className="w-full bg-neutral-900 border border-white/10 rounded-xl px-4 py-4 text-base placeholder:text-neutral-600 focus:outline-none focus:border-white/30 transition-colors"
          disabled={status === "processing"}
        />

        <div className="flex gap-3">
          <button
            onClick={submit}
            disabled={!url.trim() || status === "processing"}
            className="flex-1 bg-white hover:bg-neutral-200 disabled:opacity-30 disabled:cursor-not-allowed text-neutral-950 font-medium py-4 rounded-xl text-base transition-colors active:scale-[0.98]"
          >
            {status === "processing" ? "Procesando..." : "Convertir a Audio"}
          </button>
          <button
            onClick={() => fileInput.current?.click()}
            disabled={status === "processing"}
            className="bg-neutral-900 border border-white/10 hover:bg-neutral-800 disabled:opacity-30 text-white font-medium px-5 py-4 rounded-xl text-base transition-colors active:scale-[0.98]"
            aria-label="Subir PDF"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </button>
          <input ref={fileInput} type="file" accept=".pdf" onChange={upload} className="hidden" />
        </div>
      </div>

      {status === "processing" && (
        <div className="mt-8 space-y-3">
          <div className="flex justify-between text-sm text-neutral-500">
            <span>{message}</span>
            <span>{progress}%</span>
          </div>
          <div className="h-1 bg-neutral-900 rounded-full overflow-hidden">
            <div
              className="h-full bg-white rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="mt-8 bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      )}

      {hasAudio && (
        <div
          className="fixed bottom-0 left-0 right-0 bg-neutral-900/95 backdrop-blur-sm border-t border-white/10 px-4 pt-4 sm:static sm:mt-8 sm:rounded-xl sm:border sm:border-white/10 sm:bg-neutral-900 sm:pb-4"
          style={{ paddingBottom: "calc(16px + env(safe-area-inset-bottom, 0px))" }}
        >
          <input
            type="range"
            min={0}
            max={dur || 0}
            step={0.1}
            value={time}
            onChange={seek}
            className="w-full mb-3"
          />

          <div className="flex items-center justify-between">
            <span className="text-xs text-neutral-500 w-20 tabular-nums">
              {fmt(time)} / {fmt(dur)}
            </span>

            <button
              onClick={togglePlay}
              className="w-12 h-12 flex items-center justify-center bg-white rounded-full hover:bg-neutral-200 transition-colors active:scale-95"
              aria-label={playing ? "Pausar" : "Reproducir"}
            >
              {playing ? (
                <svg className="w-5 h-5 text-neutral-950" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-neutral-950 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                  <polygon points="5,3 19,12 5,21" />
                </svg>
              )}
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={cycleRate}
                className="text-xs font-medium text-neutral-400 hover:text-white bg-neutral-800 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg transition-colors active:scale-95"
              >
                {rate}x
              </button>
              <button
                onClick={download}
                className="text-neutral-400 hover:text-white min-w-[44px] min-h-[44px] flex items-center justify-center transition-colors active:scale-95"
                aria-label="Descargar MP3"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </button>
            </div>
          </div>

          {status === "processing" && (
            <p className="text-xs text-neutral-500 mt-2 text-center">
              {message} — {progress}%
            </p>
          )}
        </div>
      )}
    </main>
  );
}
