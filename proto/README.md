# Gemini RAG voice-chat prototype (branch `gemini-rag-prototype`)

A parallel, low-cost voice-chatbot prototype. It **does not touch the Samvaad app** (`src/`);
run it on a different port and compare answers, latency and cost.

## Pipeline

```
Browser (mic or text)
  → POST /api/voice/turn
    1. STT   gemini-3.5-transcribe     (Gujarati hint + custom vocabulary)
    2. RAG   local SQLite FTS5 over kb/*.md (query translated to English via Flash-Lite)
    3. LLM   gemini-3.5-flash-lite     (grounded, ≤2 spoken sentences)
    4. TTS   gemini-3.8-flash-lite-tts with a NATIVE Gujarati voice
            (gu-in-techagent-1 / gu-in-concierge-1 from the Extended Voice Library)
  ← { transcript, answer, audio, chunks, timings, cost }
```

All four calls use the Gemini **Interactions API** (`POST /v1beta/interactions`) and one
`GEMINI_API_KEY`. `node:sqlite` (built into Node 24) provides FTS5 — no extra dependencies.

## Run

```bash
cp proto/.env.example .env     # add GEMINI_API_KEY from AI Studio
npm run proto                  # http://localhost:3001
```

Type a Gujarati question (no mic needed) or click **🎙 Hold to speak** → release to send.
The UI shows the transcript, answer, played audio, retrieved chunks, per-stage timings
and an approximate per-turn cost in INR.

Useful endpoints:

- `GET /api/health` — index stats and model ids
- `GET /api/rag/search?q=contact` — test retrieval directly
- `POST /api/voice/turn` — `{ "question": "..." }` or `{ "audio": "<base64 webm>", "mimeType": "audio/webm", "durationMs": 8000 }`

## Cost model (pay-as-you-go, approximate)

| Stage | Rate used in readout |
|---|---|
| STT | ₹0.48 / min of caller audio |
| LLM | $0.30/M in + $2.50/M out (Flash-Lite), converted at ₹95/USD |
| TTS | $0.0015 / 10 s audio (Flash-Lite TTS promo through 2026-12-31) |

For a 1-minute conversation (30 s each way) the estimated total is ≈ **₹0.75**, vs ₹3.50
for Samvaad. All three models have a Gemini free tier — the pilot can run at ₹0 subject
to rate limits and Google's data-use terms.

## Comparison plan

1. Run the 6 Gujarati questions in `kb/README.md` against this prototype.
2. Run the same questions against the Samvaad app on :3000.
3. Compare: answer correctness, retrieved chunks, latency (`timings.totalMs`), cost.
4. If Gujarati STT accuracy is weak, swap only `config.models.stt` to Sarvam Saaras
   (still ~₹1.1/min total). If TTS voice quality is weak, use `gemini-3.8-flash-tts`
   (higher fidelity, ~₹1.28/min audio).
