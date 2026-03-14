import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

// Detect input type from URL
export function detectInputType(url: string): "pdf-url" | "gdoc" | "webpage" {
  if (/\.pdf(\?|$)/i.test(url)) return "pdf-url";
  if (/docs\.google\.com\/document/.test(url)) return "gdoc";
  return "webpage";
}

// Extract text from a PDF buffer
export async function extractFromPdf(buffer: Buffer): Promise<string> {
  const pdfParse = (await import("pdf-parse")).default;
  const result = await pdfParse(buffer);
  return result.text;
}

// Extract text from a Google Doc public URL
export async function extractFromGoogleDoc(url: string): Promise<string> {
  const match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error("Invalid Google Docs URL");
  const docId = match[1];
  const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;
  const res = await fetch(exportUrl);
  if (!res.ok) throw new Error("Could not fetch Google Doc. Make sure it's public.");
  return res.text();
}

// Extract text from a webpage using Readability
export async function extractFromWebpage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; vread/1.0)" },
  });
  if (!res.ok) throw new Error(`Could not fetch URL: ${res.status}`);
  const html = await res.text();
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  if (!article?.textContent) throw new Error("Could not extract text from this page");
  return article.textContent;
}

// Split text into chunks of roughly `maxChars` characters at sentence boundaries
export function splitIntoChunks(text: string, maxChars = 4000): string[] {
  const sentences = text.replace(/\n+/g, " ").split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (current.length + sentence.length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = "";
    }
    current += sentence + " ";
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks;
}
