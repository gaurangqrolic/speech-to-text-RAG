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
    4. TTS   gemini-3.8-flash-tts with a NATIVE Gujarati voice
            (gu-in-techagent-1 / gu-in-concierge-1 from the Extended Voice Library)
            Note: Flash-Lite TTS hit a 10-request/day free-tier cap, so we use
            the higher-fidelity Flash TTS ($9/M audio out, same API schema).
  ← { transcript, answer, audio, chunks, timings, cost }
```

All four calls use the Gemini **Interactions API** (`POST /v1beta/interactions`) and one
`GEMINI_API_KEY`. `node:sqlite` (built into Node 24) provides FTS5 — no extra dependencies.

## Conversation context, grounding & caching

- The browser keeps a `sessionId` in `sessionStorage` and sends it with every turn.
  The server keeps the last `CONTEXT_TURNS` (default 3) turns and passes them to the
  LLM so "એ / it / that" resolves correctly. Set `CONTEXT_TURNS=0` to disable.
- The LLM returns `{"answer", "sources"}`; a source filename that isn't in the
  retrieved chunks triggers a safe fallback instead of a made-up answer.
  The UI shows `grounded` / `ungrounded` on the `search query` line.
- `CACHE_ANSWERS=true` caches identical turns (question + history + model + voice)
  in memory; a repeat shows `cached` and skips LLM/TTS entirely.
- `GEMINI_LLM_MODEL` switches between `gemini-3.5-flash-lite` and
  `gemini-3.5-flash`; cost rates auto-adjust.

Bulbul extras: `SARVAM_TTS_STREAMING=true` uses `/text-to-speech/stream` for
lower time-to-first-audio; `SARVAM_TTS_PACE`, `SARVAM_TTS_TEMPERATURE`,
`SARVAM_PREPROCESSING`, and `SARVAM_TTS_DICT_ID` map to Bulbul parameters.
`enable_preprocessing` is off by default — A/B it against the digit-spaced
phone number before enabling.

## TTS provider A/B switch

`.env` → `TTS_PROVIDER=gemini` (default) or `TTS_PROVIDER=sarvam`.

- **gemini** — model from `GEMINI_TTS_MODEL` (`gemini-3.8-flash-tts` or
  `gemini-3.8-flash-lite-tts`), voice `PROTO_TTS_VOICE` (`gu-in-techagent-1`).
  The cost readout auto-adjusts to $9/M vs $6/M audio tokens.
- **sarvam** — Bulbul v4 Flash (`SARVAM_TTS_MODEL`, `SARVAM_TTS_VOICE`), needs a
  **platform API key** in `SARVAM_API_KEY` (the Voice Agents key does not work on
  `api.sarvam.ai`). Get one at https://indus.sarvam.ai/key-management.

Phone numbers are rewritten deterministically before TTS: `+91 81416 76567`
becomes `9 1, 8 1 4 1 6, 7 6 5 6 7` so the voice reads every digit separately
(including the country code) instead of "eighty-one thousand…". The displayed
`answer` stays readable; `spokenText` is what TTS receives.

`GET /api/health` shows the active provider/voice, and each turn response includes
`ttsProvider` plus a provider-aware cost estimate. Rates auto-follow the selected
model: `flash` $9/M vs `flash-lite` $6/M audio tokens, and Bulbul `v4-flash` ₹1/1k
vs `v3` ₹3/1k characters (override with `GEMINI_TTS_USD_PER_10S` /
`SARVAM_TTS_INR_PER_1K`). Free-tier usage is shown as a hypothetical paid cost.

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
| TTS | $0.00225 / 10 s audio (Flash TTS; was $0.0015 with Flash-Lite) |

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
