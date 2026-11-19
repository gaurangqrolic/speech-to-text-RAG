import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import chatRoutes from "./routes/chat.js";
import speechRoutes from "./routes/speech.js";
import textRoutes from "./routes/text.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, language: config.language.code, model: config.gemini.model });
});

app.use("/api/chat", chatRoutes);
app.use("/api", speechRoutes); // /api/stt, /api/tts
app.use("/api", textRoutes); // /api/text

// Central error handler (multer errors, JSON parse errors, etc.)
app.use((err, _req, res, _next) => {
  console.error("[server] error:", err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: err.message || "Internal server error" });
});

app.listen(config.port, () => {
  console.log(`Gujarati voice assistant running at http://localhost:${config.port}`);
  console.log(`  STT model : ${config.sarvam.sttModel} (${config.language.code})`);
  console.log(`  LLM model : ${config.gemini.model}`);
  console.log(`  TTS model : ${config.sarvam.ttsModel} / ${config.sarvam.ttsSpeaker}`);
});
