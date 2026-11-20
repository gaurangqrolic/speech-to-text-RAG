import { config } from "./config.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Thin wrapper over the Gemini Interactions API (v1beta), used for all three
 * stages of the cascade: transcribe, answer, synthesize.
 */
export async function interaction(body) {
  const res = await fetch(`${BASE}/interactions`, {
    method: "POST",
    headers: {
      "x-goog-api-key": config.apiKey,
      "Content-Type": "application/json",
      "Api-Revision": config.apiRevision,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Gemini API error ${res.status}: ${text.slice(0, 300)}`);
  }
  if (!res.ok) {
    const message = json?.[0]?.error?.message || json?.error?.message;
    throw new Error(
      `Gemini API error ${res.status}: ${message || JSON.stringify(json).slice(0, 300)}`
    );
  }
  if (json.status === "failed" || json.errors?.length) {
    throw new Error(`Gemini interaction failed: ${JSON.stringify(json.errors || json.status)}`);
  }
  return json;
}

/** Collect the final text output of an interaction. */
export function textOf(response) {
  if (response.output_text) return response.output_text.trim();
  const parts = [];
  for (const step of response.steps || []) {
    if (step.type !== "model_output") continue;
    for (const c of step.content || []) {
      if (c.type === "text" && c.text) parts.push(c.text);
    }
  }
  return parts.join("\n").trim();
}

/** Collect the last audio block (base64) from an interaction. */
export function audioOf(response) {
  let found = null;
  for (const step of response.steps || []) {
    for (const c of step.content || []) {
      if (c.type === "audio" && c.data) found = c.data;
    }
  }
  return found;
}

/**
 * Rewrite phone numbers into a form TTS will read digit-by-digit.
 * Handles "+91 81416 76567", "91 8141676567", 10 bare digits, and Gujarati digits.
 */
export function normalizePhoneForSpeech(text) {
  const guToAscii = {
    "૦": "0", "૧": "1", "૨": "2", "૩": "3", "૪": "4",
    "૫": "5", "૬": "6", "૭": "7", "૮": "8", "૯": "9",
  };
  const spaced = text.replace(/[૦-૯]/g, (d) => guToAscii[d]);
  const grouped = (a, b) => `9 1, ${a.split("").join(" ")}, ${b.split("").join(" ")}`;

  return spaced
    // +91 81416 76567 / 91-81416-76567 / 91 8141676567
    .replace(
      /\+?\s*91[\s-]*(\d{5})[\s-]*(\d{5})/g,
      (_m, a, b) => grouped(a, b)
    )
    // bare 10-digit number
    .replace(/(?<!\d)(\d{5})[\s-]*(\d{5})(?!\d)/g, (_m, a, b) => grouped(a, b));
}

/** WAV/PCM duration in seconds from base64 audio (best effort). */
export function audioSeconds(base64) {
  if (!base64) return 0;
  const buf = Buffer.from(base64, "base64");
  if (buf.length > 44 && buf.toString("ascii", 0, 4) === "RIFF") {
    const sampleRate = buf.readUInt32LE(24);
    const bits = buf.readUInt16LE(34);
    const channels = buf.readUInt16LE(22);
    const dataLen = buf.length - 44;
    return dataLen / (sampleRate * channels * (bits / 8));
  }
  return buf.length / (24000 * 2); // headerless 24kHz 16-bit PCM fallback
}

export async function transcribe({ base64, mimeType = "audio/webm" }) {
  const r = await interaction({
    model: config.models.stt,
    input: [{ type: "audio", data: base64, mime_type: mimeType }],
    generation_config: {
      transcription_config: {
        language_codes: ["gu-IN"],
        custom_vocabulary: ["Qrolic", "WordPress", "WooCommerce", "Rajkot", "Gujarati"],
        mode: "smart",
      },
    },
  });
  return { text: textOf(r), usage: r.usage, raw: r };
}

export async function answer({ question, chunks }) {
  const context = chunks.length
    ? chunks.map((c, i) => `[${i + 1}] ${c.file}\n${c.text}`).join("\n\n")
    : "(no relevant KB passages retrieved)";

  const system = [
    "You are a Qrolic Technologies team member speaking on a call. Speak as 'we', never as a search engine, brochure, or third-party narrator. Never say 'Qrolic Technologies is...' — say what WE do for the caller.",
    "Use ONLY the provided passages for facts. Never invent services, prices, clients, numbers, or capabilities we do not have.",
    "Reply in the caller's language: Gujarati for Gujarati callers, English for English callers. If replying in English, write entirely in English — never insert Gujarati words. At most two short, natural spoken sentences. Answer exactly what was asked, then stop — no filler or generic closings.",
    "Sound like a person from Qrolic, not a website: acknowledge the caller's specific situation in their own words (for example, cafe owner, moving from another technology, wanting custom functionality), then say what we can do for them. Do NOT recite marketing taglines, page headings, service lists, or phrases like 'exclusive WordPress specialists', 'trusted by leading companies', 'tailored solutions'.",
    "Never say 'according to the passage', 'the knowledge base says', 'services include', or 'our website states'. Just answer directly in our own voice.",
    "If replying in Gujarati, write technical terms in Gujarati script: વેબ ડિઝાઇન, વર્ડપ્રેસ, વૂકોમર્સ, પ્લગઇન, ઇમેઇલ. If replying in English, use plain English words.",
    "Phone numbers: keep them exactly as written in the passages (for example +91 81416 76567). The system converts them to digit-by-digit speech after you reply, so do not try to spell them out yourself.",
    "Scope rule — CRITICAL: if the caller did NOT ask for contact information, do NOT include ANY phone number, email or address in the reply. Never add a closing line like 'call us for more info'. If asked ONLY for the phone number, reply with ONLY the phone number. If asked for contact information/details, give all three (phone, info@qrolic.com, Rajkot address).",
    "If the passages do not contain the answer, say briefly that a Qrolic team member will follow up. Never mention passages, retrieval, or a knowledge base.",
  ].join(" ");

  const r = await interaction({
    model: config.models.llm,
    system_instruction: system,
    input: `Knowledge base passages:\n${context}\n\nCaller question: ${question}`,
    generation_config: { max_output_tokens: 300, thinking_level: "minimal" },
  });
  return { text: textOf(r), usage: r.usage };
}

// Deterministic Gujarati → English keyword map for the KB's topic vocabulary.
// Avoids a slow LLM round-trip for the common questions and keeps the query specific.
const KEYWORDS = [
  ["સંપર્ક", "contact"], ["નંબર", "phone number"], ["ફોન", "phone"],
  ["ઇમેઇલ", "email"], ["email", "email"], ["સરનામું", "address"],
  ["ઓફિસ", "office location"], ["ક્યાં", "where location"], ["શું", "what"],
  ["સેવા", "services"], ["સેવાઓ", "services"], ["વેબ", "web design"],
  ["વેબસાઇટ", "website"], ["વર્ડપ્રેસ", "wordpress"], ["wordpress", "wordpress"],
  ["ડિઝાઇન", "design"], ["ડેવલપ", "development"], ["માઇગ્રેશન", "migration"],
  ["માઈગ્રેશન", "migration"], ["ecommerce", "ecommerce"], ["ઇકોમર્સ", "ecommerce"],
  ["વૂકોમર્સ", "woocommerce"], ["હેલ્થ", "healthcare"], ["ફિનાન્સ", "finance banking"],
  ["બેંક", "banking"], ["એજ્યુકેશન", "education lms"], ["શિક્ષણ", "education lms"],
  ["ધીમી", "slow performance optimization"], ["ઝડપ", "speed performance"],
  ["કેસ", "case study"], ["સ્ટડી", "case study"], ["માલવેર", "malware cleanup"],
  ["હેક", "malware cleanup"], [" maintenance", "maintenance"], ["મેન્ટેનન્સ", "maintenance"],
  ["ભાવ", "pricing cost"], ["કિંમત", "pricing cost"], ["કંપની", "company about"],
  ["વિશે", "about profile"], ["જણાવો", "about profile"], ["વર્ણન", "about profile"],
  ["કોન્ટેક્ટ", "contact"], ["contact", "contact"], ["સંપર્ક", "contact"],
  ["ઇન્ફોર્મેશન", "contact details"], ["information", "contact details"],
  ["માહિતી", "contact details"], ["details", "contact details"],
  ["આપો", "share"], ["આપવું", "share"], ["નંબર", "phone number"],
  ["website", "website"], ["design", "web designing"], ["technology", "platform"],
  ["transfer", "migration"], ["migrate", "migration"], ["switch", "migration"],
  ["custom", "custom plugin functionality"], ["plugin", "plugin development"],
  ["functionality", "custom plugin development"], ["cafe", "restaurant hospitality"],
  ["restaurant", "restaurant hospitality"], ["hospitality", "restaurant hospitality"],
  ["services", "services"], ["service", "services"],
  ["case", "case study"], ["studies", "case study"], ["study", "case study"],
  ["portfolio", "case study"], ["કેસ", "case study"], ["સ્ટડી", "case study"],
];

export async function searchQuery(question) {
  const lower = question.toLowerCase();
  const hits = KEYWORDS.filter(([gu]) => lower.includes(gu)).map(([, en]) => en);
  if (hits.length >= 1) {
    return ["Qrolic", ...new Set(hits)].join(" ");
  }
  // Fallback for unusual questions: let Flash-Lite translate.
  const r = await interaction({
    model: config.models.llm,
    system_instruction:
      "Translate the caller question into 6-12 concrete English keywords for searching a company knowledge base about web design, WordPress, services, industries and contact details. Always include the company name Qrolic. Output only the keywords, no explanation.",
    input: question,
    generation_config: { max_output_tokens: 80, thinking_level: "minimal" },
  });
  return textOf(r) || question;
}

async function speakSarvam(text) {
  if (!config.sarvam.apiKey) {
    throw new Error(
      "Missing SARVAM_API_KEY (or SAMVAAD_API_KEY) needed for Bulbul TTS"
    );
  }
  const res = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: {
      "api-subscription-key": config.sarvam.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      language_code: "gu-IN",
      model: config.sarvam.model,
      speaker: config.sarvam.speaker,
      speech_sample_rate: 24000,
    }),
  });
  const raw = await res.text();
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`Sarvam TTS error ${res.status}: ${raw.slice(0, 300)}`);
  }
  if (!res.ok) {
    const message = json?.error?.message || JSON.stringify(json).slice(0, 300);
    throw new Error(`Sarvam TTS error ${res.status}: ${message}`);
  }
  const audio = Array.isArray(json.audios) ? json.audios.join("") : json.audios;
  if (!audio) throw new Error("Sarvam TTS returned no audio");
  return { audio, usage: null, requestId: json.request_id };
}

export async function speak(text) {
  if (config.ttsProvider === "sarvam") {
    const r = await speakSarvam(text);
    return { ...r, provider: "sarvam" };
  }
  if (config.ttsProvider !== "gemini") {
    throw new Error(`Unknown TTS_PROVIDER: ${config.ttsProvider}`);
  }

  const r = await interaction({
    model: config.geminiTtsModel,
    input: [
      {
        type: "user_input",
        content: [
          // No style annotation: let the native Gujarati voice carry the
          // pronunciation instead of English prosody instructions.
          { type: "text", text },
        ],
      },
    ],
    response_format: { type: "audio" },
    generation_config: { speech_config: [{ voice: config.voice }] },
  });
  return { audio: audioOf(r), usage: r.usage, provider: "gemini" };
}
