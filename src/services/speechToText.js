import { config } from "../config.js";

class SarvamApiError extends Error {
  constructor(message, { status, code, requestId } = {}) {
    super(message);
    this.name = "SarvamApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

async function readErrorResponse(response) {
  let body = null;
  try {
    body = await response.json();
  } catch {
    // non-JSON body
  }
  const details = body?.error ?? {};
  return new SarvamApiError(details.message || `Sarvam API error (HTTP ${response.status})`, {
    status: response.status,
    code: details.code,
    requestId: details.request_id ?? body?.request_id,
  });
}

/**
 * Transcribe an audio buffer to text using Sarvam's Speech-to-Text API.
 *
 * @param {object} params
 * @param {Buffer} params.buffer - Raw audio bytes (WAV, MP3, WebM, OGG, ...).
 * @param {string} params.filename - Original filename, used for format detection.
 * @param {string} [params.languageCode] - BCP-47 code, e.g. "gu-IN" or "unknown" for auto-detect.
 * @returns {Promise<{ transcript: string, languageCode: string|null, requestId: string|null }>}
 */
export async function transcribeAudio({
  buffer,
  filename = "audio.webm",
  languageCode = config.language.code,
}) {
  const form = new FormData();
  form.append("file", new Blob([buffer]), filename);
  form.append("model", config.sarvam.sttModel);
  form.append("mode", "transcribe");
  form.append("language_code", languageCode);

  const response = await fetch(config.sarvam.sttUrl, {
    method: "POST",
    headers: { "api-subscription-key": config.sarvam.apiKey },
    body: form,
  });

  if (!response.ok) throw await readErrorResponse(response);

  const data = await response.json();
  return {
    transcript: data.transcript ?? "",
    languageCode: data.language_code ?? null,
    requestId: data.request_id ?? null,
  };
}
