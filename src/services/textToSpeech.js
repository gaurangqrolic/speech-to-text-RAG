import { config } from "../config.js";

class SarvamTtsError extends Error {
  constructor(message, { status, code, requestId } = {}) {
    super(message);
    this.name = "SarvamTtsError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

/**
 * Split text into chunks of at most `max` characters, preferring sentence
 * boundaries. The TTS API rejects inputs longer than 2500 characters.
 */
function chunkText(text, max = config.sarvam.ttsMaxChars) {
  if (text.length <= max) return [text];

  const chunks = [];
  let remaining = text.trim();
  while (remaining.length > max) {
    let cut = remaining.lastIndexOf("।", max); // Devanagari danda (sentence end)
    if (cut === -1) cut = remaining.lastIndexOf(".", max);
    if (cut === -1) cut = remaining.lastIndexOf("\n", max);
    if (cut === -1) cut = max;
    chunks.push(remaining.slice(0, cut + 1).trim());
    remaining = remaining.slice(cut + 1).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

/**
 * Convert text to speech using Sarvam's Text-to-Speech API.
 * Long responses are chunked and concatenated.
 *
 * @param {object} params
 * @param {string} params.text - Gujarati (or code-mixed) text to speak.
 * @param {string} [params.languageCode] - BCP-47 code, e.g. "gu-IN".
 * @returns {Promise<Buffer>} Raw audio bytes (format follows output_audio_codec).
 */
export async function synthesizeSpeech({
  text,
  languageCode = config.language.code,
}) {
  const chunks = chunkText(text);
  const parts = [];

  for (const chunk of chunks) {
    const response = await fetch(config.sarvam.ttsUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-subscription-key": config.sarvam.apiKey,
      },
      body: JSON.stringify({
        text: chunk,
        language_code: languageCode,
        model: config.sarvam.ttsModel,
        speaker: config.sarvam.ttsSpeaker,
        output_audio_codec: "mp3",
      }),
    });

    if (!response.ok) {
      let body = null;
      try {
        body = await response.json();
      } catch {
        // non-JSON body
      }
      const details = body?.error ?? {};
      throw new SarvamTtsError(
        details.message || `Sarvam TTS error (HTTP ${response.status})`,
        {
          status: response.status,
          code: details.code,
          requestId: details.request_id ?? body?.request_id,
        }
      );
    }

    const data = await response.json();
    for (const audio of data.audios ?? []) {
      parts.push(Buffer.from(audio, "base64"));
    }
  }

  return Buffer.concat(parts);
}
