# vread.me

Web service that converts documents into spoken audio in Spanish. Paste a link or upload a PDF and start listening in seconds.

**Live:** [vread.me](https://vread.me)

## How it works

```
Input → Extract text → Split into chunks → Claude makes it speakable → ElevenLabs generates audio → SSE stream to client
```

The user provides a URL (webpage, PDF, or Google Doc) or uploads a PDF file. The server extracts the text, splits it into ~2000-character chunks at sentence boundaries, and processes up to 3 chunks in parallel. Each chunk goes through two stages:

1. **Claude Sonnet 4** rewrites the text for natural narration — converting tables to descriptions, bullets to prose, numbers to words, and varying sentence structure for rhythm.
2. **ElevenLabs Turbo v2.5** generates Spanish speech from the processed text.

Audio chunks stream to the browser via SSE as they're ready. The user starts listening as soon as the first chunk arrives, while remaining chunks process in the background.

## Architecture

One Next.js app. No microservices, no database, no auth.

```
vread/
├── app/
│   ├── page.tsx                ← Landing page
│   ├── read/page.tsx           ← Conversion UI + audio player
│   ├── api/convert/route.ts    ← Pipeline: extract → Claude → ElevenLabs → SSE
│   ├── labV1/page.tsx          ← Animation experiment: particle text morph
│   ├── labV2/page.tsx          ← Animation experiment: word consumption
│   ├── layout.tsx              ← Root layout (Inter font, B&W theme)
│   └── globals.css             ← Minimal styles + range input
├── lib/
│   ├── extract.ts              ← Text extraction (PDF, Google Docs, web)
│   └── pdf-parse.d.ts          ← Type declaration for pdf-parse
├── package.json
├── next.config.ts
├── postcss.config.mjs
└── tsconfig.json
```

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS 4 |
| Font | Inter (via next/font/google) |
| Text processing | Claude Sonnet 4 (via fetch, no SDK) |
| Speech synthesis | ElevenLabs Turbo v2.5 (via fetch, no SDK) |
| PDF extraction | pdf-parse |
| Web extraction | @mozilla/readability + jsdom |
| Streaming | Server-Sent Events (SSE) |
| Deploy | Railway |
| Package manager | npm |

Zero AI SDKs. All external API calls use native `fetch`.

## Supported inputs

| Input type | Detection | Method |
|---|---|---|
| Web page / article | Default fallback | Readability + jsdom |
| PDF URL | URL ends in `.pdf` | pdf-parse |
| Google Doc | URL contains `docs.google.com/document` | Export as plain text |
| PDF file upload | `multipart/form-data` | pdf-parse |

## Audio pipeline details

### Claude system prompt

The prompt instructs Claude to preserve all content while making it narration-ready:
- Tables → natural language descriptions
- Bullets/lists → flowing prose
- Numbers → written form ("15,000" → "quince mil")
- Varied punctuation and sentence structure for natural rhythm
- No markdown, no formatting artifacts

### ElevenLabs configuration

| Setting | Value | Why |
|---|---|---|
| Model | `eleven_turbo_v2_5` | Better Spanish prosody than multilingual_v2 |
| Voice | `x5IDPSl4ZUbhosMmVFTk` | Configurable via env var |
| Stability | 0.3 | Low = more natural intonation variation |
| Similarity boost | 0.85 | High voice consistency |
| Style | 0.3 | Adds expressiveness |
| Speaker boost | true | Clearer voice |
| Output | MP3 44100Hz 128kbps | Good quality, reasonable size |

### Chunking strategy

Text is split into ~2000-character chunks at sentence boundaries (`.!?` followed by whitespace). Smaller chunks mean faster time-to-first-audio. Up to 3 chunks process in parallel while maintaining playback order.

## SSE protocol

The `/api/convert` endpoint returns a stream of newline-delimited JSON events:

```typescript
{ type: "status", message: string, progress: number }       // Progress updates
{ type: "audio_chunk", index: number, total: number, data: string } // Base64 MP3
{ type: "complete" }                                         // All chunks done
{ type: "error", message: string }                           // Error occurred
```

## Audio player

The frontend plays audio chunks sequentially using the HTML5 `Audio` API. Each chunk gets its own blob URL and `Audio` element. When one chunk ends, the next starts automatically via the `onended` event. This avoids the glitch that comes from rebuilding a single audio element mid-playback.

Features:
- Play/pause
- Seek across chunks (calculates cumulative durations)
- Playback speed: 1x / 1.25x / 1.5x / 2x
- Download complete MP3
- Sticky player on mobile with iOS safe area support

## Robustness

- **Rate limits:** ElevenLabs 429/503 triggers automatic retry with exponential backoff (up to 3 attempts)
- **Client disconnect:** `ReadableStream.cancel()` sets a flag that skips remaining API calls
- **Input validation:** URL format check, file size limit (50MB), malformed JSON handling
- **API key check:** Clear error if keys are missing
- **Error messages:** User-facing errors in Spanish

## Design

Monochrome black and white. Inter font. Mobile-first with 44px minimum touch targets. iOS Safari tested: `viewport-fit: cover`, `safe-area-inset-bottom` on sticky player, custom range input styling.

## Environment variables

```
ANTHROPIC_API_KEY=       # Required
ELEVENLABS_API_KEY=      # Required
ELEVENLABS_VOICE_ID=     # Optional (defaults to x5IDPSl4ZUbhosMmVFTk)
PORT=3000                # Optional (defaults to 3000)
```

## Development

```bash
npm install
npm run dev
```

## Deploy

Deployed on [Railway](https://railway.com) (no Vercel — Railway has no API route timeout limits).

```bash
npm install -g @railway/cli
railway login
railway up
railway domain
```

## Lab pages

Experimental landing page animations at `/labV1` and `/labV2`:

- **labV1:** Canvas particle morph — "vread.me" text dissolves into a living audio waveform, then reforms. 6-second loop. Pure canvas + requestAnimationFrame.
- **labV2:** Word-by-word consumption — a sample paragraph fades word by word as waveform bars grow below. Natural pacing based on word length and punctuation.
