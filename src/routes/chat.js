import { Router } from "express";
import { config } from "../config.js";
import { uploadAudio } from "../middleware/upload.js";
import { transcribeAudio } from "../services/speechToText.js";
import { generateReply } from "../services/llm.js";
import { synthesizeSpeech } from "../services/textToSpeech.js";
import { retrieveContext } from "../services/rag.js";
import { getSteps, saveSteps } from "../store/sessionStore.js";

const router = Router();

/**
 * POST /api/chat
 * Full voice pipeline: audio -> Gujarati transcript -> RAG -> Gemini reply -> speech.
 *
 * multipart/form-data:
 *   audio       (file, required) - recorded audio (webm/mp3/wav/ogg...)
 *   session_id  (text, optional) - conversation session for multi-turn history
 *   language_code (text, optional) - override language, e.g. "gu-IN" or "unknown"
 *
 * Response JSON:
 *   { transcript, language_code, reply, session_id,
 *     audio: { data: <base64 mp3>, mime_type }, timings: {...} }
 */
router.post("/", uploadAudio.single("audio"), async (req, res) => {
  if (!req.file) {
    return res
      .status(400)
      .json({ error: "Missing audio file. Send a multipart field named 'audio'." });
  }

  const timings = {};
  const mark = (key) => {
    timings[`${key}_ms`] = Date.now() - timings._t0;
  };
  timings._t0 = Date.now();

  try {
    const sessionId = req.body?.session_id || "default";
    const languageCode = req.body?.language_code || config.language.code;

    // 1. Speech -> text (Sarvam STT)
    const { transcript, languageCode: detectedLanguage } = await transcribeAudio({
      buffer: req.file.buffer,
      filename: req.file.originalname || "audio.webm",
      languageCode,
    });
    mark("stt");

    if (!transcript.trim()) {
      return res.status(422).json({ error: "Could not transcribe audio (empty transcript)." });
    }

    // 2. Knowledge-base retrieval (RAG — stub until implemented)
    const context = await retrieveContext({ query: transcript });
    mark("retrieve");

    // 3. Text reply (Gemini)
    const { text: reply, steps } = await generateReply({
      userText: transcript,
      context,
      historySteps: getSteps(sessionId),
    });
    saveSteps(sessionId, steps);
    mark("llm");

    if (!reply) {
      return res.status(502).json({ error: "LLM returned an empty reply." });
    }

    // 4. Text -> speech (Sarvam TTS)
    const audioBuffer = await synthesizeSpeech({ text: reply, languageCode });
    mark("tts");

    res.json({
      transcript,
      language_code: detectedLanguage || languageCode,
      reply,
      session_id: sessionId,
      audio: {
        data: audioBuffer.toString("base64"),
        mime_type: "audio/mpeg",
      },
      timings: {
        stt_ms: timings.stt_ms,
        retrieve_ms: timings.retrieve_ms,
        llm_ms: timings.llm_ms,
        tts_ms: timings.tts_ms,
        total_ms: timings.tts_ms,
      },
    });
  } catch (err) {
    console.error("[/api/chat] error:", err);
    res.status(err.status && err.status < 600 ? err.status : 500).json({
      error: err.message || "Internal server error",
      code: err.code,
    });
  }
});

export default router;
