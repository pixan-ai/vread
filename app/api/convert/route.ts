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

Responde SOLO con el texto procesado.`;

function sseEvent(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

async function processWithClaude(text: string): Promise<string> {
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
      system: CLAUDE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: text }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error: ${res.status} ${err}`);
  }
  const data = await res.json();
  return data.content[0].text;
}

async function generateAudio(text: string): Promise<Buffer> {
  const voiceId = process.env.ELEVENLABS_VOICE_ID || "x5IDPSl4ZUbhosMmVFTk";
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
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
          stability: 0.3,
          similarity_boost: 0.85,
          style: 0,
          use_speaker_boost: true,
        },
        output_format: "mp3_44100_128",
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ElevenLabs API error: ${res.status} ${err}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(sseEvent(data)));
      };

      try {
        // Extract text from input
        send({ type: "status", message: "Extrayendo texto...", progress: 5 });

        let text: string;
        const contentType = req.headers.get("content-type") || "";

        if (contentType.includes("multipart/form-data")) {
          const formData = await req.formData();
          const file = formData.get("file") as File;
          if (!file) throw new Error("No file provided");
          const buffer = Buffer.from(await file.arrayBuffer());
          text = await extractFromPdf(buffer);
        } else {
          const body = await req.json();
          const url = body.url as string;
          if (!url) throw new Error("No URL provided");

          const inputType = detectInputType(url);
          if (inputType === "pdf-url") {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Could not fetch PDF: ${res.status}`);
            const buffer = Buffer.from(await res.arrayBuffer());
            text = await extractFromPdf(buffer);
          } else if (inputType === "gdoc") {
            text = await extractFromGoogleDoc(url);
          } else {
            text = await extractFromWebpage(url);
          }
        }

        if (!text.trim()) throw new Error("No text could be extracted");

        send({ type: "status", message: "Texto extraído. Preparando audio...", progress: 15 });

        // Split into chunks
        const chunks = splitIntoChunks(text);
        const totalChunks = chunks.length;

        send({
          type: "status",
          message: `Procesando ${totalChunks} segmento${totalChunks > 1 ? "s" : ""}...`,
          progress: 20,
        });

        // Process chunks with concurrency limit of 3
        const processChunk = async (chunk: string, index: number) => {
          const spokenText = await processWithClaude(chunk);
          const audioBuffer = await generateAudio(spokenText);
          return { index, audioBase64: audioBuffer.toString("base64") };
        };

        // Process in batches of 3, streaming results in order
        const results: Map<number, string> = new Map();
        let nextToSend = 0;

        for (let batchStart = 0; batchStart < totalChunks; batchStart += 3) {
          const batchEnd = Math.min(batchStart + 3, totalChunks);
          const batch = chunks.slice(batchStart, batchEnd).map((chunk, i) =>
            processChunk(chunk, batchStart + i)
          );

          const batchResults = await Promise.all(batch);

          for (const result of batchResults) {
            results.set(result.index, result.audioBase64);
          }

          // Send any chunks that are ready in order
          while (results.has(nextToSend)) {
            const progress = 20 + ((nextToSend + 1) / totalChunks) * 75;
            send({
              type: "audio_chunk",
              index: nextToSend,
              total: totalChunks,
              data: results.get(nextToSend)!,
            });
            send({
              type: "status",
              message: `Segmento ${nextToSend + 1} de ${totalChunks} listo`,
              progress: Math.round(progress),
            });
            results.delete(nextToSend);
            nextToSend++;
          }
        }

        send({ type: "complete" });
      } catch (error) {
        send({
          type: "error",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      } finally {
        controller.close();
      }
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
