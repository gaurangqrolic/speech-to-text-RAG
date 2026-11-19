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
  return { text: textOf(r), usage: r.usage };
}

export async function answer({ question, chunks }) {
  const context = chunks.length
    ? chunks.map((c, i) => `[${i + 1}] ${c.file}\n${c.text}`).join("\n\n")
    : "(no relevant KB passages retrieved)";

  const system = [
    "You are the voice assistant for Qrolic Technologies, a web design and WordPress company in Rajkot, India.",
    "Answer ONLY from the provided knowledge-base passages. Never invent services, prices, clients or numbers.",
    "Reply in the same language as the caller (Gujarati preferred). Maximum two short spoken sentences.",
    "If asked for contact details, read the phone number as separate digits: 8 1 4 1 6 7 6 5 6 7, and give the Rajkot address from the KB.",
    "If the passages do not contain the answer, say a Qrolic team member will follow up.",
    "Do not mention that passages, retrieval or a knowledge base exist.",
  ].join(" ");

  const r = await interaction({
    model: config.models.llm,
    system_instruction: system,
    input: `Knowledge base passages:\n${context}\n\nCaller question: ${question}`,
    generation_config: { max_output_tokens: 300 },
  });
  return { text: textOf(r), usage: r.usage };
}

export async function searchQuery(question) {
  const r = await interaction({
    model: config.models.llm,
    system_instruction:
      "Translate this caller question into a short English web-search style query for a company knowledge base about web design, WordPress, industries and contact details. Output only the query, no explanation.",
    input: question,
    generation_config: { max_output_tokens: 80 },
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
          {
            type: "text",
            text,
            annotations: [{ type: "speech_metadata", style: "warm and friendly" }],
          },
        ],
      },
    ],
    response_format: { type: "audio" },
    generation_config: { speech_config: [{ voice: config.voice }] },
  });
  return { audio: audioOf(r), usage: r.usage };
}
