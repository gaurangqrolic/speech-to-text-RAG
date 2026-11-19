import { Router } from "express";
import { config } from "../config.js";
import { uploadAudio } from "../middleware/upload.js";
import { transcribeAudio } from "../services/speechToText.js";
import { synthesizeSpeech } from "../services/textToSpeech.js";

const router = Router();

/**
 * POST /api/stt — speech to text only.
 * multipart/form-data: audio (file), language_code (optional text)
 * Response: { transcript, language_code }
 */
router.post("/stt", uploadAudio.single("audio"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Missing audio file field 'audio'." });
  }
  try {
    const result = await transcribeAudio({
      buffer: req.file.buffer,
      filename: req.file.originalname || "audio.webm",
      languageCode: req.body?.language_code || config.language.code,
    });
    res.json(result);
  } catch (err) {
    console.error("[/api/stt] error:", err);
    res.status(err.status && err.status < 600 ? err.status : 500).json({
      error: err.message || "Transcription failed",
      code: err.code,
    });
  }
});

/**
 * POST /api/tts — text to speech only.
 * JSON body: { text, language_code? }
 * Response: { audio: { data: <base64 mp3>, mime_type } }
 */
router.post("/tts", async (req, res) => {
  const { text, language_code: languageCode } = req.body ?? {};
  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "Field 'text' (string) is required." });
  }
  try {
    const audio = await synthesizeSpeech({ text, languageCode });
    res.json({
      audio: { data: audio.toString("base64"), mime_type: "audio/mpeg" },
    });
  } catch (err) {
    console.error("[/api/tts] error:", err);
    res.status(err.status && err.status < 600 ? err.status : 500).json({
      error: err.message || "Speech synthesis failed",
      code: err.code,
    });
  }
});

export default router;
