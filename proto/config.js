import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// Prefer proto/.env, then fall back to the project-root .env.
// dotenv does not override already-set keys, so a value in proto/.env wins.
dotenv.config({ path: path.join(here, ".env") });
dotenv.config({ path: path.join(here, "..", ".env") });

if (!process.env.GEMINI_API_KEY) {
  throw new Error(
    "Missing GEMINI_API_KEY. Add it to proto/.env (or the project-root .env) — see proto/.env.example."
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
