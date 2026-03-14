# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

vread.me — converts documents (URLs, PDFs, Google Docs) into spoken Spanish audio using multi-voice narration. Users paste a link or upload a PDF, the server extracts text, Claude annotates it with voice roles, ElevenLabs generates speech per role, and audio streams back via SSE.

**Live:** [vread.me](https://vread.me). Deployed on **Railway** (not Vercel — Railway has no API route timeout limits).

## Commands

```bash
npm run dev      # Start dev server (localhost:3000)
npm run build    # Production build (also validates TypeScript)
npm run start    # Start production server
```

No test suite. No configured linter (Next.js 15.5 deprecated built-in lint).

## Environment Variables

```
ANTHROPIC_API_KEY=         # Required
ELEVENLABS_API_KEY=        # Required
ELEVENLABS_VOICE_ID=       # Optional (defaults to x5IDPSl4ZUbhosMmVFTk)
ELEVENLABS_ALT_VOICE_ID=   # Optional (used for "quote" voice role, defaults to main voice)
```

## Architecture

Single Next.js 15 (App Router) app. No database, no auth, no microservices. Zero AI SDKs — all external API calls use native `fetch`.

### Pipeline (`app/api/convert/route.ts`)

```
Input → extract text → split into ~2000-char chunks → Claude Sonnet (streaming) rewrites with voice role annotations → parse [narrator]/[quote]/[data] segments → ElevenLabs TTS per segment with role-specific voice config → concatenate audio → SSE stream to client
```

Key design decisions:
- **Claude streaming API** (`stream: true`) with SSE response parsing for faster processing and AbortSignal support
- **Multi-voice**: Claude annotates output with `[narrator]`, `[quote]`, `[data]` tags. Each role maps to different ElevenLabs voice settings via `lib/voices.ts`
- **Concurrency control**: Global semaphores (`lib/queue.ts`) limit Claude (3) and ElevenLabs (2) concurrent calls across all requests
- **AbortSignal propagation**: Client disconnect aborts the full pipeline (Claude + ElevenLabs calls)
- **Structured logging**: JSON logs with trace IDs and timing via `lib/logger.ts`
- Chunks process in batches of 3 in parallel, emitted in order

### Key modules

- `lib/extract.ts` — Text extraction: PDF (pdf-parse), Google Docs (export as txt), web pages (Readability + jsdom). Contains `splitIntoChunks`.
- `lib/logger.ts` — Structured JSON logger with trace IDs and `measure()` for timing operations
- `lib/queue.ts` — `Semaphore` class for API concurrency control. Global instances: `claudeLimit`, `elevenlabsLimit`
- `lib/voices.ts` — Voice configuration per role (narrator/quote/data). Different stability, style, similarity settings per role
- `app/api/convert/route.ts` — Full pipeline: extraction → Claude streaming → role parsing → multi-voice TTS → SSE
- `app/api/balance/route.ts` — Returns ElevenLabs character usage and Anthropic key status
- `app/read/page.tsx` — Conversion UI + Web Audio API player (AudioContext + AudioBufferSourceNode for gapless playback)
- `app/page.tsx` — Landing page with canvas particle animation (text → waveform morph loop)

### SSE Protocol

The `/api/convert` endpoint streams newline-delimited JSON events: `status`, `audio_chunk` (base64 MP3), `cost`, `complete`, `error`. Response includes `X-Trace-Id` header.

### Audio Player (Web Audio API)

The `AudioEngine` class in `app/read/page.tsx` uses `AudioContext` and `AudioBufferSourceNode` for gapless playback. Each chunk is decoded via `decodeAudioData` and played sequentially. Supports play/pause, seek across chunks, playback rate changes, and MP3 download.

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS 4 |
| Font | Inter (via next/font/google) |
| Text processing | Claude Sonnet 4 (streaming, via fetch) |
| Speech synthesis | ElevenLabs Turbo v2.5 (multi-voice, via fetch) |
| PDF extraction | pdf-parse |
| Web extraction | @mozilla/readability + jsdom |
| Streaming | Server-Sent Events (SSE) |
| Deploy | Railway |

## Design

Monochrome black & white. Inter font. Mobile-first with 44px touch targets. iOS Safari safe area support on sticky player. SVG favicon (audio waveform).

## Language

UI and error messages are in English. Claude's narration system prompt outputs Spanish audio content with role annotations.
