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
const llmModel = process.env.GEMINI_LLM_MODEL || "gemini-3.5-flash-lite";
const llmIsFlash = llmModel.includes("3.5-flash") && !llmModel.includes("lite");
const sarvamTtsModel = process.env.SARVAM_TTS_MODEL || "bulbul:v4-flash";
const defaultSarvamRate = sarvamTtsModel.includes("v3") ? 3.0 : 1.0;

export const config = {
  port: Number(process.env.PROTO_PORT) || 3001,
  apiKey: process.env.GEMINI_API_KEY,
  apiRevision: "2026-05-20",
  models: {
    stt: "gemini-3.5-transcribe",
    // Answer model: gemini-3.5-flash-lite (cheap) or gemini-3.5-flash (better).
    llm: llmModel,
  },
  // Number of prior turns sent back to the LLM for conversational context.
  contextTurns: Math.max(0, Number(process.env.CONTEXT_TURNS) || 3),
  // Cache complete turns keyed by question + model + voice settings.
  cacheAnswers: process.env.CACHE_ANSWERS !== "false",
  // TTS provider switch: "gemini" (default) or "sarvam" (Bulbul v4 Flash).
  ttsProvider: (process.env.TTS_PROVIDER || "gemini").toLowerCase(),
  // Gemini TTS model A/B: gemini-3.8-flash-tts | gemini-3.8-flash-lite-tts.
  geminiTtsModel,
  voice: process.env.PROTO_TTS_VOICE || "gu-in-techagent-1",
  sarvam: {
    apiKey: process.env.SARVAM_API_KEY || process.env.SAMVAAD_API_KEY || null,
    model: sarvamTtsModel,
    speaker: process.env.SARVAM_TTS_VOICE || "shubh_enhi_ads",
    // A/B options from Bulbul v4 Flash docs.
    streaming: process.env.SARVAM_TTS_STREAMING === "true",
    preprocessing: process.env.SARVAM_PREPROCESSING === "true",
    pace: Number(process.env.SARVAM_TTS_PACE) || 1.0,
    temperature: Number(process.env.SARVAM_TTS_TEMPERATURE) || 0.6,
    dictId: process.env.SARVAM_TTS_DICT_ID || null,
  },
  // Approximate public pricing, used only for the per-turn cost readout.
  inrPerUsd: 95,
  rates: {
    // Derived from GEMINI_TTS_MODEL, or override with GEMINI_TTS_USD_PER_10S.
    geminiTtsUsdPer10s: Number(process.env.GEMINI_TTS_USD_PER_10S) || defaultTtsRate,
    // Derived from GEMINI_LLM_MODEL (Flash-Lite $0.30/$2.50, Flash $0.75/$3.75 per 1M).
    llmUsdPerMIn: llmIsFlash ? 0.75 : 0.3,
    llmUsdPerMOut: llmIsFlash ? 3.75 : 2.5,
    // Derived from SARVAM_TTS_MODEL (v3 = ₹3, v4-flash = ₹1 per 1k chars).
    sarvamTtsInrPer1kChars:
      Number(process.env.SARVAM_TTS_INR_PER_1K) || defaultSarvamRate,
  },
};
