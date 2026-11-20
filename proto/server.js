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
const sessions = new Map();
const answerCache = new Map();

function getHistory(sessionId) {
  if (!sessionId || !config.contextTurns) return [];
  return (sessions.get(sessionId) || []).slice(-config.contextTurns);
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

function ttsCost(spokenText, seconds) {
  if (config.ttsProvider === "local") return 0;
  if (config.ttsProvider === "sarvam") {
    return Number(
      ((spokenText.length / 1000) * config.rates.sarvamTtsInrPer1kChars).toFixed(4)
    );
  }
  return Number(
    ((seconds / 10) * config.rates.geminiTtsUsdPer10s * config.inrPerUsd).toFixed(4)
  );
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    ...rag.stats(),
    models: { ...config.models, tts: config.geminiTtsModel },
    ttsProvider: config.ttsProvider,
    sttProvider: config.sttProvider,
    llmProvider: config.llmProvider,
    localBackends: config.local,
    ttsVoice:
      config.ttsProvider === "sarvam"
        ? `${config.sarvam.model} / ${config.sarvam.speaker}`
        : config.ttsProvider === "local"
          ? `${config.local.ttsBackend} / ${config.local.ttsVoice}`
          : config.voice,
    streaming: config.ttsProvider === "sarvam" && config.sarvam.streaming,
    contextTurns: config.contextTurns,
    cacheAnswers: config.cacheAnswers,
  });
});

app.get("/api/rag/search", (req, res) => {
  const q = String(req.query.q || "").slice(0, 300);
  res.json({ query: q, results: rag.search(q) });
});

/** Shared STT + query + retrieval + LLM preparation for both endpoints. */
async function prepareTurn(body) {
  const t0 = Date.now();
  const timings = {};
  const sessionId = String(body.sessionId || "").slice(0, 80);
  const history = getHistory(sessionId);
  let question = String(body.question || "").trim();
  let transcript = question;
  let sttRaw = null;
  const cost = {};

  if (!question) {
    const audio = String(body.audio || "");
    if (!audio) return { error: { status: 400, body: { error: "Provide question or audio" } } };
    const sttStart = Date.now();
    const stt = await gemini.transcribe({
      base64: audio,
      mimeType: String(body.mimeType || "audio/webm"),
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
    cost.sttInr =
      config.sttProvider === "local"
        ? 0
        : Number(((Number(body.durationMs || 0) / 60000) * 0.48).toFixed(4));
  }

  if (!question) {
    return {
      error: { status: 422, body: { error: "Could not transcribe any speech", sttRaw, transcript } },
    };
  }

  const qStart = Date.now();
  const englishQuery = await gemini.searchQuery(question);
  timings.queryMs = Date.now() - qStart;

  const contactIntent =
    /(સંપર્ક|નંબર|ફોન|ઇમેઇલ|email|ઇન્ફોર્મેશન|કોન્ટેક્ટ|contact|માહિતી|information|સરનામું|ઓફિસ|ક્યાં|address|location|phone)/i.test(
      question
    );
  let chunks = contactIntent
    ? rag.search(englishQuery, 3, "page-contact-us.md")
    : rag.search(englishQuery, 3);
  if (contactIntent && !chunks.length) {
    chunks = rag.search("contact us phone email address", 3, "page-contact-us.md");
  }

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
      /(services|service|સેવાઓ|સેવा|સર્વિસ|સર્વિસીસ|સર્વિસિસ)/i.test(question)
    ) {
      topicFiles.push("page-services.md");
    }
    if (topicFiles.length) {
      const per = Math.max(1, Math.ceil(4 / topicFiles.length));
      const routed = topicFiles.flatMap((f) => rag.search(englishQuery, per, f));
      if (routed.length) chunks = routed.slice(0, 4);
    }
  }

  // Standalone FAQ-style questions don't need context in the cache key, so
  // repeats hit the cache even inside an ongoing conversation.
  const standalone = /(contact|phone|number|email|address|services|સંપર્ક|નંબર|ઇમેઇલ|સરનામું|સેવાઓ)/i.test(
    question
  );
  const key = cacheKey(question, standalone ? [] : history);
  if (config.cacheAnswers && answerCache.has(key)) {
    const hit = answerCache.get(key);
    cost.llmInr = hit.llmInr || 0;
    cost.ttsInr = hit.ttsInr || 0;
    cost.totalInr = Number(
      Object.values(cost).reduce((a, b) => a + Number(b || 0), 0).toFixed(4)
    );
    timings.cached = true;
    timings.totalMs = Date.now() - t0;
    return {
      transcript,
      sttRaw,
      cached: hit,
      cost,
      timings,
      sessionId,
      contextTurns: history.length,
    };
  }

  const llmStart = Date.now();
  const answer = await gemini.answer({ question, chunks, history });
  timings.llmMs = Date.now() - llmStart;

  if (!contactIntent) {
    const filtered = answer.text
      .split(/(?<=[.!?।]\s+)/)
      .filter(
        (s) =>
          !/(81416|76567|info@qrolic\.com|\+?\s*91[\s-]*8|ફોન|phone|call us|સંપર્ક કરો)/i.test(s)
      )
      .join(" ")
      .trim();
    if (filtered) answer.text = filtered;
  }
  answer.text = gemini.normalizeGujaratiAnswer(answer.text);

  const u = answer.usage || {};
  cost.llmInr = Number(
    (((u.total_input_tokens || 0) * config.rates.llmUsdPerMIn +
      (u.total_output_tokens || 0) * config.rates.llmUsdPerMOut) /
      1_000_000) *
      config.inrPerUsd
  ).toFixed(4);
  cost.llmInr = Number(cost.llmInr);

  return {
    _start: t0,
    transcript,
    sttRaw,
    englishQuery,
    question,
    answer,
    spokenText: gemini.normalizePhoneForSpeech(answer.text),
    chunks,
    cost,
    timings,
    sessionId,
    contextTurns: history.length,
    grounded: answer.grounded ?? null,
    sources: answer.sources || [],
    usage: { llm: u },
    key,
  };
}

function metaOf(d) {
  return {
    transcript: d.transcript,
    sttRaw: d.sttRaw,
    englishQuery: d.englishQuery,
    answer: d.answer?.text || d.cached?.answer,
    spokenText: d.spokenText || d.cached?.spokenText,
    chunks: d.chunks || d.cached?.chunks,
    grounded: d.grounded ?? d.cached?.grounded ?? null,
    sources: d.sources || d.cached?.sources || [],
    ttsProvider: config.ttsProvider,
    timings: d.timings,
    cost: d.cost,
    sessionId: d.sessionId,
    contextTurns: d.contextTurns,
    cached: !!(d.timings?.cached || d.cached),
  };
}

// Buffered JSON endpoint (kept for compatibility / debugging).
app.post("/api/voice/turn", async (req, res) => {
  try {
    const d = await prepareTurn(req.body);
    if (d.error) return res.status(d.error.status).json(d.error.body);
    if (d.cached) {
      return res.json({
        ...d.cached,
        transcript: d.transcript,
        sttRaw: d.sttRaw,
        cost: d.cost,
        timings: d.timings,
        sessionId: d.sessionId,
        contextTurns: d.contextTurns,
      });
    }
    const ttsStart = Date.now();
    let spoken = null;
    let ttsError = null;
    try {
      spoken = await gemini.speak(d.spokenText);
    } catch (err) {
      ttsError = err.message || String(err);
      console.error("[turn] TTS failed:", ttsError);
    }
    d.timings.ttsMs = Date.now() - ttsStart;
    d.timings.totalMs = Date.now() - (d._start || ttsStart);
    const seconds = gemini.audioSeconds(spoken?.audio);
    d.cost.ttsInr = spoken ? ttsCost(d.spokenText, seconds) : 0;
    d.cost.totalInr = Number(
      Object.values(d.cost).reduce((a, b) => a + Number(b || 0), 0).toFixed(4)
    );

    const payload = {
      englishQuery: d.englishQuery,
      answer: d.answer.text,
      spokenText: d.spokenText,
      audio: spoken?.audio || null,
      audioCodec: "wav",
      ttsProvider: config.ttsProvider,
      audioSeconds: Number(seconds.toFixed(2)),
      chunks: d.chunks,
      llmInr: d.cost.llmInr || 0,
      ttsInr: d.cost.ttsInr || 0,
      grounded: d.grounded,
      sources: d.sources,
      usage: { ...d.usage, tts: spoken?.usage || null },
    };
    pushHistory(d.sessionId, d.question, d.answer.text);
    if (config.cacheAnswers && !ttsError) answerCache.set(d.key, payload);
    res.json({
      transcript: d.transcript,
      sttRaw: d.sttRaw,
      ...payload,
      ...metaOf(d),
      timings: d.timings,
      cost: d.cost,
      ...(ttsError ? { error: `TTS failed: ${ttsError}` } : {}),
    });
  } catch (err) {
    console.error("[turn] error:", err.message);
    res.status(500).json({ error: err.message || "Turn failed" });
  }
});

// Streaming endpoint: audio chunks are sent as they are generated, so the
// browser can start playing before the full clip is ready.
app.post("/api/voice/stream", async (req, res) => {
  try {
    const d = await prepareTurn(req.body);
    if (d.error) return res.status(d.error.status).json(d.error.body);

    const sendMetaAnd = (codec, chunks) => {
      const meta = metaOf(d);
      meta.audioCodec = codec;
      res.set({
        "Content-Type": codec === "audio/mpeg" ? "audio/mpeg" : "audio/wav",
        "X-Meta": Buffer.from(JSON.stringify(meta)).toString("base64"),
        "Cache-Control": "no-store",
      });
      for (const c of chunks) res.write(c);
      res.end();
    };

    if (d.cached && d.cached.audio) {
      return sendMetaAnd(
        d.cached.audioCodec || "wav",
        [Buffer.from(d.cached.audio, "base64")]
      );
    }

    // Sarvam bills per character, so the TTS cost is known before streaming.
    // Set it now so the metadata header sent to the browser is complete.
    if (config.ttsProvider === "sarvam") {
      d.cost.ttsInr = ttsCost(d.spokenText, 0);
      d.cost.totalInr = Number(
        Object.values(d.cost).reduce((a, b) => a + Number(b || 0), 0).toFixed(4)
      );
    }

    const ttsStart = Date.now();
    let chunks = [];
    let codec = "wav";

    if (config.ttsProvider === "sarvam" && config.sarvam.streaming) {
      const stream = await gemini.speakStream(d.spokenText);
      codec = "audio/mpeg";
      const meta = metaOf(d);
      meta.audioCodec = codec;
      res.set({
        "Content-Type": "audio/mpeg",
        "X-Meta": Buffer.from(JSON.stringify(meta)).toString("base64"),
        "Cache-Control": "no-store",
      });
      try {
        for await (const chunk of stream) {
          const buf = Buffer.from(chunk);
          chunks.push(buf);
          res.write(buf);
        }
      } catch (err) {
        console.error("[stream] client disconnected or TTS error:", err.message);
      }
      res.end();
    } else {
      const spoken = await gemini.speak(d.spokenText);
      chunks = [Buffer.from(spoken.audio || "", "base64")];
      codec = "wav";
      sendMetaAnd(codec, chunks);
    }

    d.timings.ttsMs = Date.now() - ttsStart;
    d.timings.totalMs = Date.now() - (d._start || ttsStart);
    const seconds = config.ttsProvider === "sarvam"
      ? chunks.reduce((a, b) => a + b.length, 0) / (24000 * 2000)
      : gemini.audioSeconds(chunks[0]?.toString("base64"));
    d.cost.ttsInr = ttsCost(d.spokenText, seconds);
    d.cost.totalInr = Number(
      Object.values(d.cost).reduce((a, b) => a + Number(b || 0), 0).toFixed(4)
    );

    pushHistory(d.sessionId, d.question, d.answer.text);
    if (config.cacheAnswers) {
      answerCache.set(d.key, {
        englishQuery: d.englishQuery,
        answer: d.answer.text,
        spokenText: d.spokenText,
        audio: Buffer.concat(chunks).toString("base64"),
        audioCodec: codec,
        ttsProvider: config.ttsProvider,
        chunks: d.chunks,
        llmInr: d.cost.llmInr || 0,
        ttsInr: d.cost.ttsInr || 0,
        grounded: d.grounded,
        sources: d.sources,
        usage: d.usage,
      });
    }
  } catch (err) {
    console.error("[stream] error:", err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message || "Stream failed" });
    else res.end();
  }
});

app.use((err, _req, res, _next) => {
  console.error("[server] error:", err.message);
  res.status(err.status || 500).json({ error: err.message || "Request failed" });
});

app.listen(config.port, () => {
  console.log(`Gemini RAG voice-chat prototype at http://localhost:${config.port}`);
});
