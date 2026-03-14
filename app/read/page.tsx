"use client";

import { useState, useRef, useCallback } from "react";

type Status = "idle" | "processing" | "playing" | "error";

export default function ReadPage() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");

  // Audio state
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioChunksRef = useRef<ArrayBuffer[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showPlayer, setShowPlayer] = useState(false);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const rates = [1, 1.25, 1.5, 2];

  // Combine all audio chunks into a single blob URL for <audio> element
  const buildAudioUrl = useCallback((chunks: ArrayBuffer[]) => {
    const blob = new Blob(chunks, { type: "audio/mpeg" });
    return URL.createObjectURL(blob);
  }, []);

  const startConversion = useCallback(
    async (body: BodyInit, headers: HeadersInit = {}) => {
      setStatus("processing");
      setStatusMessage("Iniciando...");
      setProgress(0);
      setErrorMessage("");
      setShowPlayer(false);
      audioChunksRef.current = [];

      // Initialize AudioContext on user gesture for iOS Safari
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }
      // Resume if suspended (iOS requirement)
      if (audioContextRef.current.state === "suspended") {
        await audioContextRef.current.resume();
      }

      try {
        const res = await fetch("/api/convert", {
          method: "POST",
          headers: headers as Record<string, string>,
          body,
        });

        if (!res.ok || !res.body) {
          throw new Error(`Server error: ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let firstChunkReceived = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = JSON.parse(line.slice(6));

            if (data.type === "status") {
              setStatusMessage(data.message);
              setProgress(data.progress);
            } else if (data.type === "audio_chunk") {
              const binary = atob(data.data);
              const bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
              }
              audioChunksRef.current.push(bytes.buffer);

              // Show player and start playing on first chunk
              if (!firstChunkReceived) {
                firstChunkReceived = true;
                setShowPlayer(true);
                setStatus("playing");

                // Create audio element with first chunk
                const audioUrl = buildAudioUrl([bytes.buffer]);
                const audio = new Audio(audioUrl);
                audio.playbackRate = playbackRate;
                audioElementRef.current = audio;

                audio.addEventListener("timeupdate", () => {
                  setCurrentTime(audio.currentTime);
                });
                audio.addEventListener("loadedmetadata", () => {
                  setDuration(audio.duration);
                });

                await audio.play();
                setIsPlaying(true);
              } else {
                // Rebuild audio element with all chunks so far, maintaining position
                const prevAudio = audioElementRef.current;
                const wasPlaying = prevAudio && !prevAudio.paused;
                const prevTime = prevAudio?.currentTime || 0;

                const audioUrl = buildAudioUrl(audioChunksRef.current);
                const audio = new Audio(audioUrl);
                audio.playbackRate = playbackRate;
                audio.addEventListener("timeupdate", () => {
                  setCurrentTime(audio.currentTime);
                });
                audio.addEventListener("loadedmetadata", () => {
                  setDuration(audio.duration);
                  audio.currentTime = prevTime;
                  if (wasPlaying) audio.play();
                });

                if (prevAudio) {
                  prevAudio.pause();
                  URL.revokeObjectURL(prevAudio.src);
                }
                audioElementRef.current = audio;
              }
            } else if (data.type === "complete") {
              setStatusMessage("Listo");
              setProgress(100);
            } else if (data.type === "error") {
              throw new Error(data.message);
            }
          }
        }
      } catch (err) {
        setStatus("error");
        setErrorMessage(err instanceof Error ? err.message : "Error desconocido");
      }
    },
    [buildAudioUrl, playbackRate]
  );

  const handleSubmit = () => {
    if (!url.trim()) return;
    startConversion(JSON.stringify({ url: url.trim() }), {
      "Content-Type": "application/json",
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    startConversion(formData);
  };

  const togglePlayPause = () => {
    const audio = audioElementRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play();
      setIsPlaying(true);
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioElementRef.current;
    if (!audio) return;
    const time = parseFloat(e.target.value);
    audio.currentTime = time;
    setCurrentTime(time);
  };

  const cycleRate = () => {
    const nextIndex = (rates.indexOf(playbackRate) + 1) % rates.length;
    const newRate = rates[nextIndex];
    setPlaybackRate(newRate);
    if (audioElementRef.current) {
      audioElementRef.current.playbackRate = newRate;
    }
  };

  const downloadAudio = () => {
    if (audioChunksRef.current.length === 0) return;
    const blob = new Blob(audioChunksRef.current, { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vread-audio.mp3";
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <main className="min-h-dvh flex flex-col px-4 sm:px-6 pt-12 pb-40 max-w-2xl mx-auto">
      {/* Header */}
      <a href="/" className="text-xl font-bold mb-10 inline-block">
        vread<span className="text-[var(--accent)]">.me</span>
      </a>

      {/* URL Input */}
      <div className="space-y-3">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder="Pega un link (web, PDF, Google Doc)"
          className="w-full bg-[var(--bg-card)] border border-white/10 rounded-xl px-4 py-4 text-base placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
          disabled={status === "processing"}
        />

        <div className="flex gap-3">
          <button
            onClick={handleSubmit}
            disabled={!url.trim() || status === "processing"}
            className="flex-1 bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-4 rounded-xl text-base transition-colors"
          >
            Convertir a Audio
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={status === "processing"}
            className="bg-[var(--bg-card)] border border-white/10 hover:bg-[var(--bg-hover)] disabled:opacity-40 text-white font-medium px-5 py-4 rounded-xl text-base transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            onChange={handleFileUpload}
            className="hidden"
          />
        </div>
      </div>

      {/* Progress */}
      {status === "processing" && (
        <div className="mt-8 space-y-3">
          <div className="flex justify-between text-sm text-[var(--text-muted)]">
            <span>{statusMessage}</span>
            <span>{progress}%</span>
          </div>
          <div className="h-1.5 bg-[var(--bg-card)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--accent)] rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Error */}
      {status === "error" && (
        <div className="mt-8 bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-xl text-sm">
          {errorMessage}
        </div>
      )}

      {/* Audio Player — sticky bottom on mobile */}
      {showPlayer && (
        <div className="fixed bottom-0 left-0 right-0 bg-[var(--bg-card)] border-t border-white/10 px-4 py-4 sm:static sm:mt-8 sm:rounded-xl sm:border sm:border-white/10">
          {/* Progress bar */}
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            className="w-full h-1.5 mb-3 accent-[var(--accent)] cursor-pointer"
          />

          <div className="flex items-center justify-between">
            {/* Time */}
            <span className="text-xs text-[var(--text-muted)] w-20">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>

            {/* Controls */}
            <div className="flex items-center gap-4">
              <button
                onClick={togglePlayPause}
                className="w-12 h-12 flex items-center justify-center bg-[var(--accent)] rounded-full hover:bg-[var(--accent-hover)] transition-colors"
              >
                {isPlaying ? (
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="4" width="4" height="16" />
                    <rect x="14" y="4" width="4" height="16" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                    <polygon points="5,3 19,12 5,21" />
                  </svg>
                )}
              </button>
            </div>

            {/* Rate + Download */}
            <div className="flex items-center gap-3">
              <button
                onClick={cycleRate}
                className="text-xs font-medium text-[var(--text-muted)] hover:text-white bg-[var(--bg-hover)] px-2.5 py-1.5 rounded-lg transition-colors"
              >
                {playbackRate}x
              </button>
              <button
                onClick={downloadAudio}
                className="text-[var(--text-muted)] hover:text-white transition-colors"
                title="Descargar MP3"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </button>
            </div>
          </div>

          {/* Status during processing */}
          {status === "processing" && (
            <p className="text-xs text-[var(--text-muted)] mt-2 text-center">
              {statusMessage} — {progress}%
            </p>
          )}
        </div>
      )}
    </main>
  );
}
