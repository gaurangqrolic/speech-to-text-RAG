import "dotenv/config";

if (!process.env.GEMINI_API_KEY) {
  throw new Error(
    "Missing GEMINI_API_KEY. Copy proto/.env.example to .env and add a Google AI Studio key."
  );
}

export const config = {
  port: Number(process.env.PROTO_PORT) || 3001,
  apiKey: process.env.GEMINI_API_KEY,
  apiRevision: "2026-05-20",
  models: {
    stt: "gemini-3.5-transcribe",
    llm: "gemini-3.5-flash-lite",
    tts: "gemini-3.8-flash-lite-tts",
  },
  voice: process.env.PROTO_TTS_VOICE || "Kore",
  // Approximate public pricing, INR per USD for the cost readout only.
  inrPerUsd: 95,
};
