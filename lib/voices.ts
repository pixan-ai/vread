export type VoiceRole = "narrator" | "quote" | "data";

export type VoiceConfig = {
  voiceId: string;
  stability: number;
  similarityBoost: number;
  style: number;
  speakerBoost: boolean;
};

const DEFAULT_VOICE = "x5IDPSl4ZUbhosMmVFTk";

export function getVoice(role: VoiceRole): VoiceConfig {
  const main = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE;
  const alt = process.env.ELEVENLABS_ALT_VOICE_ID || main;

  const configs: Record<VoiceRole, VoiceConfig> = {
    narrator: { voiceId: main, stability: 0.3, similarityBoost: 0.85, style: 0.3, speakerBoost: true },
    quote:    { voiceId: alt,  stability: 0.4, similarityBoost: 0.9,  style: 0.5, speakerBoost: true },
    data:     { voiceId: main, stability: 0.5, similarityBoost: 0.85, style: 0.15, speakerBoost: true },
  };

  return configs[role];
}
