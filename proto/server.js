import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import * as gemini from "./gemini.js";
import * as rag from "./rag.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "25mb" }));
app.use(express.static(path.join(__dirname, "public")));

const init = rag.buildIndex();
console.log(`[rag] indexed ${init.files} files / ${init.chunks} chunks`);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ...rag.stats(), models: config.models });
});

app.get("/api/rag/search", (req, res) => {
  const q = String(req.query.q || "").slice(0, 300);
  res.json({ query: q, results: rag.search(q) });
});

/**
 * One turn of the voice chatbot.
 * Body: { question } for text tests, or { audio, mimeType, durationMs } for voice.
 */
app.post("/api/voice/turn", async (req, res) => {
  const t0 = Date.now();
  try {
    const timings = {};
    let question = String(req.body.question || "").trim();
    let transcript = question;
    let sttRaw = null;
    const cost = {};

    if (!question) {
      const audio = String(req.body.audio || "");
      if (!audio) {
        return res.status(400).json({ error: "Provide question or audio" });
      }
      const sttStart = Date.now();
      console.log(
        `[turn] audio received: ${audio.length} base64 chars, mime=${req.body.mimeType || "audio/webm"}, duration=${req.body.durationMs || "?"}ms`
      );
      const stt = await gemini.transcribe({
        base64: audio,
        mimeType: String(req.body.mimeType || "audio/webm"),
      });
      transcript = stt.text;
      question = transcript;
      timings.sttMs = Date.now() - sttStart;
      sttRaw = JSON.stringify(
        {
          status: stt.raw?.status,
          text: stt.text,
          usage: stt.usage,
          steps: stt.raw?.steps,
          errors: stt.raw?.errors,
        },
        null,
        2
      );
      cost.sttInr = Number(
        ((Number(req.body.durationMs || 0) / 60000) * 0.48).toFixed(4)
      );
    }

    if (!question) {
      return res
        .status(422)
        .json({ error: "Could not transcribe any speech", sttRaw, transcript });
    }

    const qStart = Date.now();
    const englishQuery = await gemini.searchQuery(question);
    timings.queryMs = Date.now() - qStart;

    // Contact questions have a canonical document; FTS over the whole corpus
    // gets distracted by CTA sections on every service page.
    // Use the caller's ORIGINAL question, not the expanded English query —
    // an LLM-expanded query can contain the word "contact" for unrelated asks.
    const contactIntent =
      /(સંપર્ક|નંબર|ફોન|ઇમેઇલ|email|સરનામું|ઓફિસ|ક્યાં|contact number|phone number|address|location)/i.test(
        question
      );
    const chunks = contactIntent
      ? rag.search(englishQuery, 5, "page-contact-us.md")
      : rag.search(englishQuery, 5);

    const llmStart = Date.now();
    const answer = await gemini.answer({ question, chunks });
    timings.llmMs = Date.now() - llmStart;
    const u = answer.usage || {};
    cost.llmInr = Number(
      (
        ((u.total_input_tokens || 0) * 0.3 + (u.total_output_tokens || 0) * 2.5) /
        1_000_000 *
        config.inrPerUsd
      ).toFixed(4)
    );

    // TTS is the last stage — if it fails (e.g. rate limit), still return
    // everything that already succeeded so the UI can show the STT response.
    const ttsStart = Date.now();
    let spoken = null;
    let ttsError = null;
    try {
      spoken = await gemini.speak(answer.text);
    } catch (err) {
      ttsError = err.message || String(err);
      console.error("[turn] TTS failed:", ttsError);
    }
    timings.ttsMs = Date.now() - ttsStart;
    const seconds = gemini.audioSeconds(spoken?.audio);
    // gemini-3.8-flash-tts: $9/M audio out = $0.00225 per 10s.
    cost.ttsInr = spoken
      ? Number(((seconds / 10) * 0.00225 * config.inrPerUsd).toFixed(4))
      : 0;

    timings.totalMs = Date.now() - t0;
    cost.totalInr = Number(
      Object.values(cost).reduce((a, b) => a + Number(b || 0), 0).toFixed(4)
    );

    res.json({
      transcript,
      sttRaw,
      englishQuery,
      answer: answer.text,
      audio: spoken?.audio || null,
      audioSeconds: Number(seconds.toFixed(2)),
      chunks,
      timings,
      cost,
      ...(ttsError ? { error: `TTS failed: ${ttsError}` } : {}),
      usage: { llm: u, tts: spoken?.usage || null },
    });
  } catch (err) {
    console.error("[turn] error:", err.message);
    res.status(500).json({ error: err.message || "Turn failed" });
  }
});

// Return JSON even for body-parser errors (e.g. 413 Payload Too Large),
// otherwise the browser's res.json() fails with an empty-body error.
app.use((err, _req, res, _next) => {
  console.error("[server] error:", err.message);
  res.status(err.status || 500).json({ error: err.message || "Request failed" });
});

app.listen(config.port, () => {
  console.log(`Gemini RAG voice-chat prototype at http://localhost:${config.port}`);
});
