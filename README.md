# Gujarati Voice Assistant (Speech → LLM → Speech)

A Node.js service where users **speak in Gujarati**, and an AI replies with **Gujarati text + Gujarati speech** — without training any LLM.

```
🎤 Audio (Gujarati speech)
   │
   ▼
Sarvam STT (saaras:v4, gu-IN)         ← speech → text
   │
   ▼
RAG knowledge base (stub, later)       ← retrieves relevant context
   │
   ▼
Gemini LLM (Google AI Studio key)      ← generates Gujarati reply
   │
   ▼
Sarvam TTS (bulbul:v3, gu-IN)          ← text → Gujarati speech
   │
   ▼
🔊 Gujarati audio reply (mp3)
```

## Why this architecture works

- **No training needed** — existing models handle Gujarati natively:
  - Sarvam STT supports `gu-IN` transcription out of the box.
  - Gemini generates fluent Gujarati text.
  - Sarvam TTS has dedicated Gujarati voices (e.g. `bhavik_gu_conversation`, `pooja_gu_conversational`).
- **RAG is a drop-in later** — `src/services/rag.js` is a stub; `generateReply()` already accepts context chunks and injects them into the prompt.
- **Conversation memory** lives in `src/store/sessionStore.js` (Gemini is called with `store: false`, so history stays on your server).

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
#    - SARVAM_API_KEY  → https://dashboard.sarvam.ai
#    - GEMINI_API_KEY  → https://aistudio.google.com/apikey

# 3. Run
npm run dev        # or: npm start
```

Open http://localhost:3000 — a test page lets you record from the mic and hear the reply.

## API

| Method | Endpoint | Body | Returns |
|---|---|---|---|
| POST | `/api/chat` | multipart: `audio` (file), `session_id?`, `language_code?` | `transcript`, `reply`, `audio` (base64 mp3), `timings` |
| POST | `/api/stt` | multipart: `audio` (file) | `transcript`, `language_code` |
| POST | `/api/tts` | JSON: `text`, `language_code?` | `audio` (base64 mp3) |
| POST | `/api/text` | JSON: `text`, `session_id?`, `speak?` | `reply`, `audio?` |
| GET | `/api/health` | — | status + active config |

Example (text-only, skips the mic):

```bash
curl -X POST http://localhost:3000/api/text \
  -H 'Content-Type: application/json' \
  -d '{"text": "તમારું નામ શું છે?"}'
```

## Project structure

```
src/
├── server.js               # Express entry
├── config.js               # env-driven config + validation
├── middleware/upload.js    # multer (memory storage, 25 MB)
├── routes/
│   ├── chat.js             # full pipeline: audio → reply → audio
│   ├── speech.js           # standalone /api/stt and /api/tts
│   └── text.js             # text-only chat
├── services/
│   ├── speechToText.js     # Sarvam STT client
│   ├── llm.js              # Gemini client + Gujarati system prompt
│   ├── textToSpeech.js     # Sarvam TTS client (chunks long text)
│   └── rag.js              # knowledge-base stub ← implement later
└── store/sessionStore.js   # in-memory multi-turn history
public/index.html           # mic test page
```

## Roadmap

1. **RAG knowledge base** — implement `src/services/rag.js`:
   - Chunk documents → embed with a Gujarati-capable multilingual model (Gemini `gemini-embedding-001`, `text-embedding-004`, or multilingual-e5) → store in a vector DB (Chroma/Qdrant/pgvector) → return top-k chunks.
2. **Streaming latency** — stream Gemini output and synthesize TTS per sentence to cut first-audio latency from ~4-6s to ~1-2s.
3. **Continuous conversation** — add VAD (e.g. Silero) so users speak without pressing a button; or evaluate Gemini Live API for end-to-end streaming audio.
4. **Persistence** — move `sessionStore` to Redis; add auth/rate limits.

## Configuration reference

See `.env.example` for all options: model names, TTS speaker/voice, language code, port.
