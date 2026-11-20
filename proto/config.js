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

const geminiTtsModel = process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts";
const defaultTtsRate = geminiTtsModel.includes("flash-lite") ? 0.0015 : 0.00225;

export const config = {
  port: Number(process.env.PROTO_PORT) || 3001,
  apiKey: process.env.GEMINI_API_KEY,
  apiRevision: "2026-05-20",
  models: {
    stt: "gemini-3.5-transcribe",
    llm: "gemini-3.5-flash-lite",
  },
  // TTS provider switch: "gemini" (default) or "sarvam" (Bulbul v4 Flash).
  ttsProvider: (process.env.TTS_PROVIDER || "gemini").toLowerCase(),
  // Gemini TTS model A/B: gemini-3.8-flash-tts | gemini-3.8-flash-lite-tts.
  geminiTtsModel,
  voice: process.env.PROTO_TTS_VOICE || "gu-in-techagent-1",
  sarvam: {
    apiKey: process.env.SARVAM_API_KEY || process.env.SAMVAAD_API_KEY || null,
    model: process.env.SARVAM_TTS_MODEL || "bulbul:v4-flash",
    speaker: process.env.SARVAM_TTS_VOICE || "shubh_enhi_ads",
  },
  // Approximate public pricing, used only for the per-turn cost readout.
  inrPerUsd: 95,
  rates: {
    // Derived from GEMINI_TTS_MODEL, or override with GEMINI_TTS_USD_PER_10S.
    geminiTtsUsdPer10s: Number(process.env.GEMINI_TTS_USD_PER_10S) || defaultTtsRate,
    sarvamTtsInrPer1kChars: 1.0, // bulbul:v4-flash docs rate
  },
};
