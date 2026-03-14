import { NextRequest } from "next/server";
import {
  detectInputType,
  extractFromPdf,
  extractFromGoogleDoc,
  extractFromWebpage,
  splitIntoChunks,
} from "@/lib/extract";

export const maxDuration = 300;

const CLAUDE_SYSTEM_PROMPT = `Eres un asistente que prepara textos para ser narrados en audio en español.

REGLAS:
1. PRESERVA TODO el contenido. No resumas, no omitas nada.
2. TABLAS: Descríbelas naturalmente: "Se muestra una tabla que contiene [columnas] y [filas]. La tabla indica que [interpretación]."
3. Convierte listas y bullets en texto narrativo fluido.
4. Elimina artifacts: headers/footers repetidos, números de página, caracteres basura, URLs largas.
5. Todo debe ser texto plano narrativo. Sin markdown, sin bullets, sin asteriscos.
6. Números escritos para lectura natural: "15,000" → "quince mil".
7. Transiciones suaves entre secciones.
8. Usa puntuación variada para crear ritmo natural: combina oraciones cortas con oraciones más largas. Agrega comas donde haya pausas naturales al hablar. Evita que todas las oraciones tengan la misma longitud.
9. Varía la estructura sintáctica: no empieces todas las oraciones igual. Alterna entre sujeto-verbo-complemento, complemento al inicio, oraciones subordinadas, preguntas retóricas y enumeraciones. El texto debe sonar como una persona hablando, no como un robot leyendo.

Responde SOLO con el texto procesado.`;

function sseEvent(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

// Cost tracking (Sonnet: $3/M input, $15/M output)
const SONNET_INPUT_COST = 3 / 1_000_000;
const SONNET_OUTPUT_COST = 15 / 1_000_000;
// ElevenLabs: ~$0.30 per 1000 characters (varies by plan)
const ELEVENLABS_COST_PER_CHAR = 0.30 / 1000;

type CostAccumulator = { claudeInput: number; claudeOutput: number; elevenlabsChars: number };

async function processWithClaude(text: string, cost: CostAccumulator): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      system: CLAUDE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: text }],
    }),
  });

  if (!res.ok) {
    if (res.status === 429) {
      throw new Error("Claude API: rate limit reached. Try again in a few minutes.");
    }
    throw new Error(`Claude API error: ${res.status}`);
  }

  const data = await res.json();
  cost.claudeInput += data.usage?.input_tokens ?? 0;
  cost.claudeOutput += data.usage?.output_tokens ?? 0;
  return data.content[0].text;
}

async function generateAudio(text: string, cost: CostAccumulator): Promise<Buffer> {
  if (!process.env.ELEVENLABS_API_KEY) {
    throw new Error("ELEVENLABS_API_KEY not configured");
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID || "x5IDPSl4ZUbhosMmVFTk";

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_turbo_v2_5",
          voice_settings: {
            stability: 0.3,
            similarity_boost: 0.85,
            style: 0.3,
            use_speaker_boost: true,
          },
          output_format: "mp3_44100_128",
        }),
      }
    );

    if (res.ok) {
      cost.elevenlabsChars += text.length;
      return Buffer.from(await res.arrayBuffer());
    }

    // Retry on rate limit or temporary server error
    if ((res.status === 429 || res.status === 503) && attempt < 2) {
      const retryAfter = parseInt(res.headers.get("retry-after") || "3", 10);
      await new Promise((r) => setTimeout(r, Math.max(retryAfter, 2) * 1000 * (attempt + 1)));
      continue;
    }

    throw new Error(
      res.status === 429
        ? "ElevenLabs: rate limit reached. Try again in a few minutes."
        : `ElevenLabs API error: ${res.status}`
    );
  }

  throw new Error("ElevenLabs: max retries exceeded");
}

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  let cancelled = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(sseEvent(data)));
        } catch {
          cancelled = true;
        }
      };

      try {
        send({ type: "status", message: "Extracting text...", progress: 5 });

        let text: string;
        const contentType = req.headers.get("content-type") || "";

        if (contentType.includes("multipart/form-data")) {
          const formData = await req.formData();
          const file = formData.get("file") as File;
          if (!file) throw new Error("No file received");
          if (file.size > 50 * 1024 * 1024) throw new Error("File too large (max 50MB)");
          const buffer = Buffer.from(await file.arrayBuffer());
          text = await extractFromPdf(buffer);
        } else {
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

          const inputType = detectInputType(url);
          if (inputType === "pdf-url") {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Could not download PDF (${res.status})`);
            const buffer = Buffer.from(await res.arrayBuffer());
            text = await extractFromPdf(buffer);
          } else if (inputType === "gdoc") {
            text = await extractFromGoogleDoc(url);
          } else {
            text = await extractFromWebpage(url);
          }
        }

        if (!text.trim()) throw new Error("Could not extract text from document");

        send({ type: "status", message: "Text extracted. Preparing audio...", progress: 15 });

        const chunks = splitIntoChunks(text);
        const totalChunks = chunks.length;

        send({
          type: "status",
          message: `Processing ${totalChunks} segment${totalChunks > 1 ? "s" : ""}...`,
          progress: 20,
        });

        const cost: CostAccumulator = { claudeInput: 0, claudeOutput: 0, elevenlabsChars: 0 };

        const processChunk = async (chunk: string, index: number) => {
          if (cancelled) return null;
          const spokenText = await processWithClaude(chunk, cost);
          if (cancelled) return null;
          const audioBuffer = await generateAudio(spokenText, cost);
          return { index, audioBase64: audioBuffer.toString("base64") };
        };

        const results: Map<number, string> = new Map();
        let nextToSend = 0;

        for (let batchStart = 0; batchStart < totalChunks && !cancelled; batchStart += 3) {
          const batchEnd = Math.min(batchStart + 3, totalChunks);
          const batch = chunks.slice(batchStart, batchEnd).map((chunk, i) =>
            processChunk(chunk, batchStart + i)
          );

          const batchResults = await Promise.all(batch);

          for (const result of batchResults) {
            if (!result || cancelled) continue;
            results.set(result.index, result.audioBase64);
          }

          while (results.has(nextToSend) && !cancelled) {
            const progress = 20 + ((nextToSend + 1) / totalChunks) * 75;
            send({
              type: "audio_chunk",
              index: nextToSend,
              total: totalChunks,
              data: results.get(nextToSend)!,
            });
            send({
              type: "status",
              message: `Segment ${nextToSend + 1} of ${totalChunks} ready`,
              progress: Math.round(progress),
            });
            results.delete(nextToSend);
            nextToSend++;
          }
        }

        if (!cancelled) {
          const claudeCost = cost.claudeInput * SONNET_INPUT_COST + cost.claudeOutput * SONNET_OUTPUT_COST;
          const elevenlabsCost = cost.elevenlabsChars * ELEVENLABS_COST_PER_CHAR;
          send({
            type: "cost",
            claude: Math.round(claudeCost * 1000) / 1000,
            elevenlabs: Math.round(elevenlabsCost * 1000) / 1000,
            total: Math.round((claudeCost + elevenlabsCost) * 1000) / 1000,
          });
          send({ type: "complete" });
        }
      } catch (error) {
        if (!cancelled) {
          send({
            type: "error",
            message: error instanceof Error ? error.message : "Unknown error",
          });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Controller already closed
        }
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
