import "dotenv/config";

const missing = ["SARVAM_API_KEY", "GEMINI_API_KEY"].filter((key) => !process.env[key]);
if (missing.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missing.join(", ")}\n` +
      "Copy .env.example to .env and fill in your API keys."
  );
}

export const config = {
  port: Number(process.env.PORT) || 3000,

  sarvam: {
    apiKey: process.env.SARVAM_API_KEY,
    sttUrl: "https://api.sarvam.ai/speech-to-text",
    ttsUrl: "https://api.sarvam.ai/text-to-speech",
    sttModel: process.env.SARVAM_STT_MODEL || "saaras:v4",
    ttsModel: process.env.SARVAM_TTS_MODEL || "bulbul:v3",
    ttsSpeaker: process.env.SARVAM_TTS_SPEAKER || "shubh",
    // bulbul:v3 and bulbul:v4-flash accept at most 2500 characters per request
    ttsMaxChars: 2500,
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || "gemini-3.5-flash",
  },

  language: {
    // BCP-47 code used for both STT input and TTS output
    code: process.env.LANGUAGE_CODE || "gu-IN",
  },

  assistant: {
    name: process.env.ASSISTANT_NAME || "Sahayak",
  },
};
