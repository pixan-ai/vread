"use client";

import { useState, useRef, useEffect, useCallback } from "react";

// --- Types ---

type Balance = {
  elevenlabs: { used: number; limit: number; remaining: number } | null;
  anthropic: { status: string } | null;
};
type Cost = { claude: number; elevenlabs: number; total: number };
type Status = "idle" | "processing" | "playing" | "error";

// --- Web Audio Engine ---

class AudioEngine {
  private ctx: AudioContext;
  private gain: GainNode;
  private source: AudioBufferSourceNode | null = null;
  private buffers: AudioBuffer[] = [];
  private raw: ArrayBuffer[] = [];
  private chunkIdx = 0;
  private offset = 0;
  private playStart = 0;
  private _playing = false;
  private _rate = 1;
  private _done = false;
  private onUpdate: () => void;

  constructor(onUpdate: () => void) {
    this.ctx = new AudioContext();
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
    this.onUpdate = onUpdate;
  }

  get playing() {
    return this._playing;
  }
  get rate() {
    return this._rate;
  }
  get hasAudio() {
    return this.buffers.length > 0;
  }

  get currentTime(): number {
    if (!this._playing) return this.chunkElapsed(this.chunkIdx) + this.offset;
    const played = (this.ctx.currentTime - this.playStart) * this._rate;
    return this.chunkElapsed(this.chunkIdx) + this.offset + played;
  }

  get duration(): number {
    let d = 0;
    for (const b of this.buffers) d += b.duration;
    return d;
  }

  private chunkElapsed(upTo: number): number {
    let t = 0;
    for (let i = 0; i < upTo && i < this.buffers.length; i++) t += this.buffers[i].duration;
    return t;
  }

  async addChunk(data: ArrayBuffer) {
    this.raw.push(data);
    // decodeAudioData detaches the buffer, so clone first
    const buffer = await this.ctx.decodeAudioData(data.slice(0));
    this.buffers.push(buffer);

    if (this.buffers.length === 1) {
      this.play();
    } else if (this._playing && !this.source) {
      // Was waiting for next chunk
      this.playChunk(this.chunkIdx);
    }
    this.onUpdate();
  }

  play() {
    if (this._playing) return;
    this.ctx.resume();
    this._playing = true;
    this.playChunk(this.chunkIdx);
    this.onUpdate();
  }

  pause() {
    if (!this._playing) return;
    const elapsed = (this.ctx.currentTime - this.playStart) * this._rate;
    this.offset += elapsed;
    this.stopSource();
    this._playing = false;
    this.onUpdate();
  }

  seek(time: number) {
    for (let i = 0; i < this.buffers.length; i++) {
      const start = this.chunkElapsed(i);
      const end = start + this.buffers[i].duration;
      if (time < end || i === this.buffers.length - 1) {
        this.chunkIdx = i;
        this.offset = Math.max(0, time - start);
        if (this._playing) {
          this.stopSource();
          this.playChunk(i);
        }
        this.onUpdate();
        return;
      }
    }
  }

  setRate(rate: number) {
    if (this._playing && this.source) {
      const elapsed = (this.ctx.currentTime - this.playStart) * this._rate;
      this.offset += elapsed;
      this.source.playbackRate.value = rate;
      this.playStart = this.ctx.currentTime;
    }
    this._rate = rate;
    this.onUpdate();
  }

  setDone() {
    this._done = true;
  }

  downloadBlob(): Blob {
    return new Blob(this.raw, { type: "audio/mpeg" });
  }

  destroy() {
    this.stopSource();
    this.ctx.close();
  }

  private playChunk(index: number) {
    this.stopSource();

    if (index >= this.buffers.length) {
      if (this._done) {
        this._playing = false;
        this.onUpdate();
      }
      // else: waiting for next chunk, source stays null
      return;
    }

    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[index];
    src.playbackRate.value = this._rate;
    src.connect(this.gain);

    src.onended = () => {
      if (this.chunkIdx === index && this._playing) {
        this.chunkIdx = index + 1;
        this.offset = 0;
        this.playChunk(index + 1);
      }
    };

    this.chunkIdx = index;
    this.playStart = this.ctx.currentTime;
    src.start(0, this.offset);
    this.source = src;
  }

  private stopSource() {
    try {
      this.source?.stop();
    } catch {
      // Already stopped
    }
    this.source = null;
  }
}

// --- Helpers ---

function fmt(s: number): string {
  return `${Math.floor(s / 60)}:${Math.floor(s % 60)
    .toString()
    .padStart(2, "0")}`;
}

function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return n.toString();
}

const RATES = [1, 1.25, 1.5, 2] as const;

// --- Page ---

export default function ReadPage() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [balance, setBalance] = useState<Balance | null>(null);
  const [cost, setCost] = useState<Cost | null>(null);

  // Audio state (driven by engine callbacks)
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [rate, setRate] = useState(1);
  const [hasAudio, setHasAudio] = useState(false);

  const engineRef = useRef<AudioEngine | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Sync UI with audio engine state
  const syncUI = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    setPlaying(e.playing);
    setDur(e.duration);
    setRate(e.rate);
    setHasAudio(e.hasAudio);
  }, []);

  // Tick: update current time while playing
  useEffect(() => {
    if (playing) {
      timerRef.current = setInterval(() => {
        if (engineRef.current?.playing) {
          setTime(engineRef.current.currentTime);
        }
      }, 100);
    } else {
      clearInterval(timerRef.current);
      if (engineRef.current) setTime(engineRef.current.currentTime);
    }
    return () => clearInterval(timerRef.current);
  }, [playing]);

  // Fetch balance on mount
  useEffect(() => {
    fetch("/api/balance")
      .then((r) => r.json())
      .then(setBalance)
      .catch(() => {});
  }, []);

  // --- Conversion ---

  async function convert(body: BodyInit, headers: Record<string, string> = {}) {
    // Cleanup previous
    engineRef.current?.destroy();
    const engine = new AudioEngine(syncUI);
    engineRef.current = engine;

    setStatus("processing");
    setMessage("Connecting...");
    setProgress(0);
    setError("");
    setHasAudio(false);
    setCost(null);
    setTime(0);
    setDur(0);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch("/api/convert", {
        method: "POST",
        headers,
        body,
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`Server error: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let evt: Record<string, unknown>;
          try {
            evt = JSON.parse(line.slice(6));
          } catch {
            continue;
          }

          switch (evt.type) {
            case "status":
              setMessage((evt.message as string) || "");
              setProgress((evt.progress as number) || 0);
              break;

            case "audio_chunk": {
              if (!evt.data) break;
              const raw = atob(evt.data as string);
              const bytes = new Uint8Array(raw.length);
              for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
              await engine.addChunk(bytes.buffer);
              if (!hasAudio) setStatus("playing");
              break;
            }

            case "cost":
              setCost({
                claude: evt.claude as number,
                elevenlabs: evt.elevenlabs as number,
                total: evt.total as number,
              });
              break;

            case "complete":
              engine.setDone();
              setMessage("Done");
              setProgress(100);
              fetch("/api/balance")
                .then((r) => r.json())
                .then(setBalance)
                .catch(() => {});
              break;

            case "error":
              throw new Error((evt.message as string) || "Unknown error");
          }
        }
      }
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setStatus("error");
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  function cancel() {
    abortRef.current?.abort();
    setStatus("idle");
    setMessage("");
    setProgress(0);
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
    const e = engineRef.current;
    if (!e) return;
    if (e.playing) e.pause();
    else e.play();
  }

  function seek(e: React.ChangeEvent<HTMLInputElement>) {
    engineRef.current?.seek(parseFloat(e.target.value));
  }

  function cycleRate() {
    const e = engineRef.current;
    if (!e) return;
    const idx = RATES.indexOf(e.rate as (typeof RATES)[number]);
    e.setRate(RATES[(idx + 1) % RATES.length]);
  }

  function download() {
    const blob = engineRef.current?.downloadBlob();
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "vread-audio.mp3";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // --- UI ---

  return (
    <main className="min-h-dvh flex flex-col px-4 sm:px-6 pt-8 pb-48 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <a
          href="/"
          className="flex items-center gap-2 text-neutral-500 hover:text-white transition-colors min-h-[44px]"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span className="text-sm">Home</span>
        </a>
        <span className="text-xl font-bold">
          vread<span className="text-neutral-500">.me</span>
        </span>
        <div className="w-16" />
      </div>

      {/* Balance */}
      {balance?.elevenlabs && (
        <div className="flex gap-3 mb-6 text-xs">
          <div className="flex-1 bg-neutral-900 border border-white/10 rounded-lg px-3 py-2.5">
            <span className="text-neutral-500 block">ElevenLabs</span>
            <span className="text-white tabular-nums">{fmtK(balance.elevenlabs.remaining)} chars</span>
            <span className="text-neutral-600"> / {fmtK(balance.elevenlabs.limit)}</span>
          </div>
          <div className="flex-1 bg-neutral-900 border border-white/10 rounded-lg px-3 py-2.5">
            <span className="text-neutral-500 block">Claude</span>
            <span className="text-white">
              {balance.anthropic?.status === "configured" ? "Active" : "Not configured"}
            </span>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="space-y-3">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Paste a link (web, PDF, Google Doc)"
          className="w-full bg-neutral-900 border border-white/10 rounded-xl px-4 py-4 text-base placeholder:text-neutral-600 focus:outline-none focus:border-white/30 transition-colors"
          disabled={status === "processing"}
        />

        <div className="flex gap-3">
          <button
            onClick={submit}
            disabled={!url.trim() || status === "processing"}
            className="flex-1 bg-white hover:bg-neutral-200 disabled:opacity-30 disabled:cursor-not-allowed text-neutral-950 font-medium py-4 rounded-xl text-base transition-colors active:scale-[0.98]"
          >
            {status === "processing" ? "Processing..." : "Convert to Audio"}
          </button>

          {status === "processing" ? (
            <button
              onClick={cancel}
              className="bg-neutral-900 border border-red-500/30 hover:bg-red-500/10 text-red-400 font-medium px-5 py-4 rounded-xl text-base transition-colors active:scale-[0.98]"
              aria-label="Cancel"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-neutral-900 border border-white/10 hover:bg-neutral-800 text-white font-medium px-5 py-4 rounded-xl text-base transition-colors active:scale-[0.98]"
              aria-label="Upload PDF"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
            </button>
          )}
          <input ref={fileInputRef} type="file" accept=".pdf" onChange={upload} className="hidden" />
        </div>
      </div>

      {/* Progress */}
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

      {/* Error */}
      {status === "error" && (
        <div className="mt-8 bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      )}

      {/* Audio Player */}
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
              aria-label={playing ? "Pause" : "Play"}
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
                aria-label="Download MP3"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
              </button>
            </div>
          </div>

          {status === "processing" && (
            <p className="text-xs text-neutral-500 mt-2 text-center">
              {message} — {progress}%
            </p>
          )}

          {cost && (
            <p className="text-[10px] text-neutral-600 mt-2 text-center tabular-nums">
              Cost: ${cost.total.toFixed(3)} (Claude ${cost.claude.toFixed(3)} + ElevenLabs $
              {cost.elevenlabs.toFixed(3)})
            </p>
          )}
        </div>
      )}
    </main>
  );
}
