import { NextRequest } from "next/server";
import {
  detectInputType,
  extractFromPdf,
  extractFromGoogleDoc,
  extractFromWebpage,
  splitIntoChunks,
} from "@/lib/extract";
import { createTrace } from "@/lib/logger";
import { claudeLimit, elevenlabsLimit } from "@/lib/queue";
import { getVoice, type VoiceRole } from "@/lib/voices";

export const maxDuration = 300;

const COST_RATES = {
  claudeInput: 3 / 1_000_000,
  claudeOutput: 15 / 1_000_000,
  elevenlabsChar: 0.30 / 1000,
};

type CostAcc = { claudeIn: number; claudeOut: number; elChars: number };
type Segment = { text: string; role: VoiceRole };

const SYSTEM_PROMPT = `Eres un asistente que prepara textos para narración en audio en español con múltiples voces.

REGLAS:
1. PRESERVA TODO el contenido. No resumas, no omitas nada.
2. Envuelve cada sección con etiquetas de voz:
   [narrator]...[/narrator] para narración general
   [quote]...[/quote] para citas directas, diálogos y referencias textuales
   [data]...[/data] para estadísticas, cifras y datos técnicos
3. Por defecto usa [narrator] para todo el contenido general.
4. TABLAS: Marca los datos numéricos con [data] y las descripciones con [narrator].
5. Convierte listas y bullets en texto narrativo fluido.
6. Elimina artifacts: headers/footers repetidos, números de página, caracteres basura, URLs largas.
7. Números escritos para lectura natural: "15,000" → "quince mil".
8. Transiciones suaves entre secciones.
9. Usa puntuación variada para crear ritmo natural: combina oraciones cortas con largas. Comas donde haya pausas naturales.
10. Varía la estructura sintáctica: no empieces todas las oraciones igual. El texto debe sonar como una persona hablando.

Responde SOLO con el texto procesado usando las etiquetas de voz.`;

// Parse Claude's role-annotated output into voice segments
function parseSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  const re = /\[(narrator|quote|data)\]([\s\S]*?)\[\/\1\]/g;
  let last = 0;
  let m;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      const gap = text.slice(last, m.index).trim();
      if (gap) segments.push({ text: gap, role: "narrator" });
    }
    const content = m[2].trim();
    if (content) segments.push({ text: content, role: m[1] as VoiceRole });
    last = re.lastIndex;
  }

  const tail = text.slice(last).trim();
  if (tail) segments.push({ text: tail, role: "narrator" });
  return segments.length ? segments : [{ text: text.trim(), role: "narrator" }];
}

// Stream Claude response, return accumulated text + token usage
async function callClaude(
  text: string,
  signal: AbortSignal,
  cost: CostAcc,
): Promise<string> {
  return claudeLimit.run(async () => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8192,
        stream: true,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: text }],
      }),
      signal,
    });

    if (!res.ok) {
      if (res.status === 429) throw new Error("Claude API: rate limit reached. Try again in a few minutes.");
      throw new Error(`Claude API error: ${res.status}`);
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let result = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6);
        if (raw === "[DONE]") continue;
        try {
          const evt = JSON.parse(raw);
          if (evt.type === "content_block_delta" && evt.delta?.text) {
            result += evt.delta.text;
          } else if (evt.type === "message_start" && evt.message?.usage) {
            cost.claudeIn += evt.message.usage.input_tokens ?? 0;
          } else if (evt.type === "message_delta" && evt.usage) {
            cost.claudeOut += evt.usage.output_tokens ?? 0;
          }
        } catch {
          // Skip malformed events
        }
      }
    }

    return result;
  });
}

// Generate audio with retry, respecting voice role
async function generateAudio(
  text: string,
  role: VoiceRole,
  signal: AbortSignal,
  cost: CostAcc,
): Promise<Buffer> {
  return elevenlabsLimit.run(async () => {
    const voice = getVoice(role);

    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voice.voiceId}/stream`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "xi-api-key": process.env.ELEVENLABS_API_KEY!,
          },
          body: JSON.stringify({
            text,
            model_id: "eleven_turbo_v2_5",
            voice_settings: {
              stability: voice.stability,
              similarity_boost: voice.similarityBoost,
              style: voice.style,
              use_speaker_boost: voice.speakerBoost,
            },
            output_format: "mp3_44100_128",
          }),
          signal,
        },
      );

      if (res.ok) {
        cost.elChars += text.length;
        return Buffer.from(await res.arrayBuffer());
      }

      if ((res.status === 429 || res.status === 503) && attempt < 2) {
        const base = Math.max(parseInt(res.headers.get("retry-after") || "3", 10), 2);
        await new Promise((r) => setTimeout(r, base * 1000 * (attempt + 1)));
        continue;
      }

      throw new Error(
        res.status === 429
          ? "ElevenLabs: rate limit reached. Try again in a few minutes."
          : `ElevenLabs API error: ${res.status}`,
      );
    }

    throw new Error("ElevenLabs: max retries exceeded");
  });
}

// Extract text from the incoming request
async function extractText(req: NextRequest, signal: AbortSignal): Promise<string> {
  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    if (!file) throw new Error("No file received");
    if (file.size > 50 * 1024 * 1024) throw new Error("File too large (max 50MB)");
    return extractFromPdf(Buffer.from(await file.arrayBuffer()));
  }

  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    throw new Error("Invalid request");
  }

  const url = body.url;
  if (!url) throw new Error("No URL provided");
  try {
    new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }

  const type = detectInputType(url);
  if (type === "pdf-url") {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Could not download PDF (${res.status})`);
    return extractFromPdf(Buffer.from(await res.arrayBuffer()));
  }
  if (type === "gdoc") return extractFromGoogleDoc(url);
  return extractFromWebpage(url);
}

export async function POST(req: NextRequest) {
  const trace = createTrace();
  const encoder = new TextEncoder();
  const abort = new AbortController();
  const { signal } = abort;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        if (signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          abort.abort();
        }
      };

      try {
        if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
        if (!process.env.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY not configured");

        trace.info("pipeline.start");
        send({ type: "status", message: "Extracting text...", progress: 5 });

        const text = await trace.measure("extract", () => extractText(req, signal));
        if (!text.trim()) throw new Error("Could not extract text from document");

        send({ type: "status", message: "Text extracted. Preparing audio...", progress: 15 });

        const chunks = splitIntoChunks(text);
        const total = chunks.length;
        trace.info("chunks.ready", { count: total, chars: text.length });

        send({
          type: "status",
          message: `Processing ${total} segment${total > 1 ? "s" : ""}...`,
          progress: 20,
        });

        const cost: CostAcc = { claudeIn: 0, claudeOut: 0, elChars: 0 };
        const results = new Map<number, Buffer>();
        let nextToSend = 0;

        // Process in batches of 3, preserving order
        for (let batch = 0; batch < total && !signal.aborted; batch += 3) {
          const batchEnd = Math.min(batch + 3, total);
          const batchResults = await Promise.all(
            chunks.slice(batch, batchEnd).map(async (chunk, i) => {
              const index = batch + i;
              if (signal.aborted) return null;

              const processed = await callClaude(chunk, signal, cost);
              if (signal.aborted) return null;

              // Multi-voice: parse role segments, generate audio for each, concatenate
              const segments = parseSegments(processed);
              const audioChunks: Buffer[] = [];
              for (const seg of segments) {
                if (signal.aborted) return null;
                audioChunks.push(await generateAudio(seg.text, seg.role, signal, cost));
              }

              return { index, audio: Buffer.concat(audioChunks) };
            }),
          );

          for (const r of batchResults) {
            if (!r || signal.aborted) continue;
            results.set(r.index, r.audio);
          }

          // Emit in order
          while (results.has(nextToSend) && !signal.aborted) {
            const progress = 20 + ((nextToSend + 1) / total) * 75;
            send({
              type: "audio_chunk",
              index: nextToSend,
              total,
              data: results.get(nextToSend)!.toString("base64"),
            });
            send({
              type: "status",
              message: `Segment ${nextToSend + 1} of ${total} ready`,
              progress: Math.round(progress),
            });
            results.delete(nextToSend);
            nextToSend++;
          }
        }

        if (!signal.aborted) {
          const claudeCost =
            cost.claudeIn * COST_RATES.claudeInput +
            cost.claudeOut * COST_RATES.claudeOutput;
          const elCost = cost.elChars * COST_RATES.elevenlabsChar;
          send({
            type: "cost",
            claude: Math.round(claudeCost * 1000) / 1000,
            elevenlabs: Math.round(elCost * 1000) / 1000,
            total: Math.round((claudeCost + elCost) * 1000) / 1000,
          });
          send({ type: "complete" });
          trace.info("pipeline.complete", {
            chunks: total,
            tokens: cost.claudeIn + cost.claudeOut,
            chars: cost.elChars,
            cost: Math.round((claudeCost + elCost) * 1000) / 1000,
          });
        }
      } catch (error) {
        if (!signal.aborted) {
          const msg = error instanceof Error ? error.message : "Unknown error";
          send({ type: "error", message: msg });
          trace.error("pipeline.error", { error: msg });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Trace-Id": trace.id,
    },
  });
}
