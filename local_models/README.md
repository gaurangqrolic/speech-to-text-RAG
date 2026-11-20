# Local Gujarati model benchmark (branch `local-model-benchmark`)

Research, model configurations and a small stdlib-only harness for comparing
**local CPU models** for STT, LLM answer generation and TTS. This branch is for
testing only — the Samvaad app (`main`) and streaming prototype
(`gemini-rag-prototype`) are untouched.

See [`research.md`](research.md) for verified model cards, licenses and caveats.

## Setup

Python 3.10+ (tested on 3.14). Create a venv and install only what you need:

```bash
python3 -m venv .venv
source .venv/bin/activate

# TTS (install CPU torch first only if a backend needs it)
pip install -r local_models/requirements-tts.txt
pip install torch --index-url https://download.pytorch.org/whl/cpu

# STT
pip install -r local_models/requirements-stt.txt

# LLM
pip install -r local_models/requirements-llm.txt
```

Models are downloaded on **first use** into the Hugging Face cache. `piper` is
gated — accept its conditions on HF before running that backend.

## Run the harness

```bash
LOCAL_MODELS_PORT=4000 python local_models/server.py
```

In another shell:

```bash
python local_models/benchmark.py --task tts --backends indic_tiny,mithi
python local_models/benchmark.py --task llm --backends qwen_1_5b,kemcho_gemma
python local_models/benchmark.py --task stt --backends whisper_small  # needs audio_path in test_cases.json
```

Results (audio + JSON timings) land under `local_models/results/<timestamp>/`.

## Endpoints

| Endpoint | Request | Response |
|---|---|---|
| `GET /health` | – | loaded backends |
| `GET /models` | – | `config.json` |
| `POST /tts` | `{backend, text, voice?, speed?}` | WAV bytes |
| `POST /stt` | `{backend, audio_path}` or `{backend, audio_b64}` | `{text, seconds}` |
| `POST /llm` | `{backend, system?, prompt, max_tokens?}` | `{text, seconds}` |

Backend definitions live in `config.json`; each has a `runner` implemented in
`server.py`. Add a new model by adding one config entry and, if needed, one
runner function.

## Test order

1. TTS: `indic_tiny` → `mithi` → `pocket` → `piper`
2. STT: `whisper_small` → `whisper_medium_ct2` → `indicconformer`
3. LLM: `qwen_1_5b` → `kemcho_gemma` → `qwen_0_5b`

Judge with native Gujarati listeners on: conversational sentences, mixed
English words, brand names, numbers and phone numbers. Compare against the
current Bulbul/Gemini cascade from `gemini-rag-prototype`.
