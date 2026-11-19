# Qrolic Voice Assistant (Gujarati)

A web voice assistant where users **speak in Gujarati** and an AI replies with Gujarati
speech + live text transcripts — powered by **Sarvam Samvaad (Voice Agents)** with a
**server-side API-key proxy**, plus a seed **knowledge base** extracted from qrolic.com.

```
🎤 Browser (public/index.html + bundled Web SDK)
   │  mic audio (16 kHz PCM) + transcripts/state callbacks
   ▼
Express server (this app)
   ├─ GET /api/config        → non-secret agent ids for the frontend
   └─ /api/sarvam/*          → KEY PROXY: injects X-API-Key, forwards to
   │                            apps.sarvam.ai/api/app-runtime/... signed-URL endpoint
   ▼
Samvaad session (signed WebSocket URL → direct browser ↔ Sarvam)
   │  realtime ASR (Saaras v4) → LLM (Gujarati-aware) → TTS (Bulbul) + barge-in
   ▼
🔊 Sub-second Gujarati voice replies, live transcript in the UI
```

The API key **never reaches the browser**: the SDK requests a short-lived signed
WebSocket URL through `/api/sarvam`, and the proxy validates the path (only
`orgs/…/workspaces/…/apps/…/url`), rate-limits per IP, injects the key, and passes
the response through. Audio then flows directly over the signed URL.

## Setup

### 1. Samvaad workspace (once)

1. Create a workspace at [indus.sarvam.ai → Voice Agents](https://indus.sarvam.ai)
2. Build an agent: set instruction/persona, language **Gujarati (gu-IN)**, a Bulbul voice
3. **Attach a Knowledge Base** — upload the 23 files from [`kb/`](kb/README.md) (Markdown supported)
4. **Commit a version** (Deploy → Versions) — the Web SDK refuses to connect without a committed version
5. Copy from Settings: **API key**, and from the workspace/agent URLs: **org id, workspace id, app id**

### 2. This app

```bash
npm install
cp .env.example .env        # fill SAMVAAD_API_KEY + the three ids
npm run dev                 # builds the client bundle, starts server on :3000
```

Open http://localhost:3000 → **Start conversation** → speak Gujarati.

> Mic access requires HTTPS in production (localhost is exempt).

### Test questions (Gujarati)

See [`kb/README.md`](kb/README.md) — e.g. *તમારો સંપર્ક નંબર શું છે?* should return the
phone/email/address from the KB's contact page.

## Project structure

```
src/
├── server.js                 # Express entry: static, /api/config, proxy mount
├── config.js                 # env validation (fails fast without SAMVAAD_API_KEY)
├── routes/sarvamProxy.js     # the key proxy (path allowlist + rate limit)
└── client/main.js            # Web SDK usage → bundled to public/app.js
public/
├── index.html                # voice UI: transcripts, state pill, level meter
└── app.js                    # build artifact (npm run build)
kb/                           # 23 qrolic.com docs for the Samvaad KB + tools/
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | build client + run server with `--watch` |
| `npm start` | build client + run server |
| `npm run build` | bundle `src/client/main.js` → `public/app.js` (esbuild) |
| `npm run watch:client` | rebuild bundle on change (use alongside `dev`) |

## Environment (`.env`)

| Variable | Required | Notes |
|---|---|---|
| `SAMVAAD_API_KEY` | ✅ | Voice Agents API key — server-side only |
| `SAMVAAD_ORG_ID` / `SAMVAAD_WORKSPACE_ID` / `SAMVAAD_APP_ID` | ✅ | non-secret, served to browser via `/api/config` |
| `PORT` | – | default 3000 |
| `SAMVAAD_RUNTIME_BASE_URL` | – | default `https://apps.sarvam.ai/api/app-runtime/` |

## Roadmap

1. **Test KB retrieval** with the Gujarati questions in `kb/README.md` (simulated calls: ₹2/run)
2. **Custom KB endpoint** — if you outgrow the built-in KB, add `/api/kb/search` and point a Samvaad API tool at it (patterns from `qrolic-indexer` apply: SQLite FTS5 + multilingual embeddings + hybrid search)
3. **on_start hook** — preload caller context before the first word
4. Mobile — the same agent runs on Samvaad's React Native / Flutter SDKs
