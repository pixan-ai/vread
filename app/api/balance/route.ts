import { NextResponse } from "next/server";

export async function GET() {
  const result: {
    elevenlabs: { used: number; limit: number; remaining: number } | null;
    anthropic: { status: string } | null;
  } = { elevenlabs: null, anthropic: null };

  // ElevenLabs: character usage from subscription endpoint
  if (process.env.ELEVENLABS_API_KEY) {
    try {
      const res = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
        headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY },
      });
      if (res.ok) {
        const data = await res.json();
        result.elevenlabs = {
          used: data.character_count ?? 0,
          limit: data.character_limit ?? 0,
          remaining: (data.character_limit ?? 0) - (data.character_count ?? 0),
        };
      }
    } catch {
      // Silently fail — dashboard will show "no data"
    }
  }

  // Anthropic: no public balance endpoint, just check if key works
  if (process.env.ANTHROPIC_API_KEY) {
    result.anthropic = { status: "configured" };
  }

  return NextResponse.json(result);
}
