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

export function splitIntoChunks(text: string, maxChars = 2000): string[] {
  const clean = text.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const chunks: string[] = [];
  let current = "";

  for (const sentence of clean.split(/(?<=[.!?])\s+/)) {
    if (current.length + sentence.length + 1 > maxChars && current) {
      chunks.push(current);
      current = sentence;
    } else {
      current += (current ? " " : "") + sentence;
    }
  }
  if (current) chunks.push(current);

  return chunks;
}
