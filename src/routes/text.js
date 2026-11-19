import { Router } from "express";
import { config } from "../config.js";
import { generateReply } from "../services/llm.js";
import { synthesizeSpeech } from "../services/textToSpeech.js";
import { retrieveContext } from "../services/rag.js";
import { getSteps, saveSteps } from "../store/sessionStore.js";

const router = Router();

/**
 * POST /api/text — text-only chat (skips STT), still returns speech.
 * JSON body: { text, session_id?, speak?=true }
 * Response: { reply, session_id, audio? }
 */
router.post("/text", async (req, res) => {
  const { text, session_id: sessionId = "default", speak = true } = req.body ?? {};
  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "Field 'text' (string) is required." });
  }

  try {
    const context = await retrieveContext({ query: text });
    const { text: reply, steps } = await generateReply({
      userText: text,
      context,
      historySteps: getSteps(sessionId),
    });
    saveSteps(sessionId, steps);

    if (!reply) {
      return res.status(502).json({ error: "LLM returned an empty reply." });
    }

    const payload = { reply, session_id: sessionId };
    if (speak) {
      const audio = await synthesizeSpeech({ text: reply, languageCode: config.language.code });
      payload.audio = { data: audio.toString("base64"), mime_type: "audio/mpeg" };
    }
    res.json(payload);
  } catch (err) {
    console.error("[/api/text] error:", err);
    res.status(err.status && err.status < 600 ? err.status : 500).json({
      error: err.message || "Internal server error",
      code: err.code,
    });
  }
});

export default router;
