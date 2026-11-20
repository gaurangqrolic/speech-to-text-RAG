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
    "You are the voice assistant for Qrolic Technologies, a web design and WordPress company in Rajkot, India.",
    "Answer ONLY from the provided knowledge-base passages. Never invent services, prices, clients or numbers.",
    "Reply in the caller's language (Gujarati preferred), in at most two short spoken sentences. Answer exactly what was asked and stop — never add filler or generic closings like 'contact the team for more information'.",
    "Use Gujarati script for words, including technical terms: વેબ ડિઝાઇન, વર્ડપ્રેસ, વૂકોમર્સ, ઇમેઇલ.",
    "PHONE NUMBERS: always write ASCII digits, with the country code and spaces between digit groups — the KB number +91 81416 76567 must be spoken as '91 8 1 4 1 6 7 6 5 6 7'. Never use Gujarati digits and never concatenate the digits into one long number.",
    "Scope rule: if asked ONLY for the phone number, reply with ONLY the phone number and nothing else. Never volunteer the address, email, or a closing line. Mention the address only if the caller explicitly asks for address/location; mention email only if the caller asks for email or full contact details.",
    "If asked for contact information / contact details / 'contact information', give ALL THREE from the KB: the phone number, the email info@qrolic.com, and the Rajkot address. This is the one case where more than one fact is expected.",
    "If the passages do not contain the answer, say briefly that a Qrolic team member will follow up.",
    "Do not mention that passages, retrieval or a knowledge base exist.",
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

export async function speak(text) {
  const r = await interaction({
    model: config.models.tts,
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
  return { audio: audioOf(r), usage: r.usage };
}
