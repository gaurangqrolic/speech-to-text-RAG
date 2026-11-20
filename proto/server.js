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

// In-memory conversation context and answer cache. Both reset on restart.
const sessions = new Map(); // sessionId -> [{role, text}]
const answerCache = new Map(); // key -> cached turn payload

function getHistory(sessionId) {
  if (!sessionId || !config.contextTurns) return [];
  const turns = sessions.get(sessionId) || [];
  return turns.slice(-config.contextTurns);
}

function pushHistory(sessionId, question, answerText) {
  if (!sessionId || !config.contextTurns) return;
  const turns = sessions.get(sessionId) || [];
  turns.push({ role: "user", text: question });
  turns.push({ role: "assistant", text: answerText });
  sessions.set(sessionId, turns.slice(-config.contextTurns * 2));
}

function cacheKey(question, history) {
  return JSON.stringify({
    question,
    history,
    llm: config.models.llm,
    provider: config.ttsProvider,
    tts:
      config.ttsProvider === "sarvam"
        ? `${config.sarvam.model}|${config.sarvam.speaker}|${config.sarvam.streaming}|${config.sarvam.preprocessing}|${config.sarvam.pace}|${config.sarvam.temperature}`
        : `${config.geminiTtsModel}|${config.voice}`,
  });
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    ...rag.stats(),
    models: { ...config.models, tts: config.geminiTtsModel },
    ttsProvider: config.ttsProvider,
    ttsVoice:
      config.ttsProvider === "sarvam"
        ? `${config.sarvam.model} / ${config.sarvam.speaker}`
        : config.voice,
  });
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
    const sessionId = String(req.body.sessionId || "").slice(0, 80);
    const history = getHistory(sessionId);
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
      /(સંપર્ક|નંબર|ફોન|ઇમેઇલ|email|ઇન્ફોર્મેશન|કોન્ટેક્ટ|contact|માહિતી|information|સરનામું|ઓફિસ|ક્યાં|address|location|phone)/i.test(
        question
      );
    let chunks = contactIntent
      ? rag.search(englishQuery, 5, "page-contact-us.md")
      : rag.search(englishQuery, 5);
    // If the translated query was too generic, still force the contact doc.
    if (contactIntent && !chunks.length) {
      chunks = rag.search("contact us phone email address", 5, "page-contact-us.md");
    }

    // Topic routing: pull the documents that actually answer multi-part asks
    // instead of letting a generic "Qrolic wordpress" query hit brochure pages.
    if (!contactIntent) {
      const topicFiles = [];
      if (/(migration|migrate|transfer|switch|સ્થાનાંતર|માઇગ્રેશન|માઈગ્રેશન)/i.test(question)) {
        topicFiles.push("service-wordpress-migration.md");
      }
      if (/(custom|plugin|functionality|કસ્ટમ|પ્લગઇન|ફંક્શન)/i.test(question)) {
        topicFiles.push("service-plugin-development.md");
      }
      if (/(cafe|restaurant|hospitality|કેફે|રેસ્ટોરન્ટ|હોસ્પિટાલિટી)/i.test(question)) {
        topicFiles.push("page-leading-web-design-web-development-and-wordpress-company.md");
      }
      if (/(case\s*stud|portfolio|studies|કેસ|સ્ટડી)/i.test(question)) {
        topicFiles.push(
          "case-study-qrolic-website-speed-performance-optimization.md",
          "case-study-wordpress-malware-cleanup-case-study.md",
          "case-study-first-pass-airport-website.md"
        );
      }
      if (
        !topicFiles.length &&
        /(services|service|સેવાઓ|સેવા)/i.test(question)
      ) {
        topicFiles.push("page-services.md");
      }
      if (topicFiles.length) {
        const per = Math.max(2, Math.ceil(6 / topicFiles.length));
        const routed = topicFiles.flatMap((f) => rag.search(englishQuery, per, f));
        if (routed.length) chunks = routed.slice(0, 6);
      }
    }

    // Exact-turn cache: repeat questions get a zero-LLM/zero-TTS response.
    const key = cacheKey(question, history);
    if (config.cacheAnswers && answerCache.has(key)) {
      const hit = answerCache.get(key);
      const cachedCost = {
        ...(cost.sttInr ? { sttInr: cost.sttInr } : {}),
        llmInr: hit.llmInr || 0,
        ttsInr: hit.ttsInr || 0,
      };
      cachedCost.totalInr = Number(
        Object.values(cachedCost).reduce((a, b) => a + Number(b || 0), 0).toFixed(4)
      );
      timings.cached = true;
      timings.totalMs = Date.now() - t0;
      return res.json({
        transcript,
        sttRaw,
        ...hit,
        cost: cachedCost,
        timings,
        sessionId,
        contextTurns: history.length,
      });
    }

    const llmStart = Date.now();
    const answer = await gemini.answer({ question, chunks, history });
    timings.llmMs = Date.now() - llmStart;

    // Safety net: the LLM sometimes appends a contact line even when it was
    // not asked. Drop any sentence containing contact details if the caller
    // did not request contact information.
    if (!contactIntent) {
      const filtered = answer.text
        .split(/(?<=[.!?।]\s+)/)
        .filter(
          (s) =>
            !/(81416|76567|info@qrolic\.com|\+?\s*91[\s-]*8|ફોન|phone|call us|સંપર્ક કરો)/i.test(
              s
            )
        )
        .join(" ")
        .trim();
      if (filtered) answer.text = filtered;
    }
    const u = answer.usage || {};
    cost.llmInr = Number(
      (
        ((u.total_input_tokens || 0) * config.rates.llmUsdPerMIn +
          (u.total_output_tokens || 0) * config.rates.llmUsdPerMOut) /
        1_000_000 *
        config.inrPerUsd
      ).toFixed(4)
    );

    // TTS is the last stage — if it fails (e.g. rate limit), still return
    // everything that already succeeded so the UI can show the STT response.
    // Keep the displayed answer readable, but feed TTS a digit-by-digit version
    // of any phone number so it is never read as a large whole number.
    const spokenText = gemini.normalizePhoneForSpeech(answer.text);
    const ttsStart = Date.now();
    let spoken = null;
    let ttsError = null;
    try {
      spoken = await gemini.speak(spokenText);
    } catch (err) {
      ttsError = err.message || String(err);
      console.error("[turn] TTS failed:", ttsError);
    }
    timings.ttsMs = Date.now() - ttsStart;
    const seconds = gemini.audioSeconds(spoken?.audio);
    cost.ttsInr = spoken
      ? config.ttsProvider === "sarvam"
        ? Number(
            ((spokenText.length / 1000) * config.rates.sarvamTtsInrPer1kChars).toFixed(4)
          )
        : Number(
            (
              (seconds / 10) *
              config.rates.geminiTtsUsdPer10s *
              config.inrPerUsd
            ).toFixed(4)
          )
      : 0;

    timings.totalMs = Date.now() - t0;
    cost.totalInr = Number(
      Object.values(cost).reduce((a, b) => a + Number(b || 0), 0).toFixed(4)
    );

    const payload = {
      englishQuery,
      answer: answer.text,
      spokenText,
      audio: spoken?.audio || null,
      ttsProvider: config.ttsProvider,
      audioSeconds: Number(seconds.toFixed(2)),
      chunks,
      llmInr: cost.llmInr || 0,
      ttsInr: cost.ttsInr || 0,
      grounded: answer.grounded ?? null,
      sources: answer.sources || [],
      usage: { llm: u, tts: spoken?.usage || null },
    };
    pushHistory(sessionId, question, answer.text);
    if (config.cacheAnswers && !ttsError) answerCache.set(key, payload);

    res.json({
      transcript,
      sttRaw,
      ...payload,
      timings,
      cost,
      sessionId,
      contextTurns: history.length,
      ...(ttsError ? { error: `TTS failed: ${ttsError}` } : {}),
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
