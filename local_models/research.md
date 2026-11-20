# Local Gujarati model research (verified 2026-11-20)

Sources are Hugging Face model cards / official docs. Sizes and licenses are from
those cards; latency figures are **author-reported**, not measured by us.

## TTS

| Backend | Repo | Size | License | Notes |
|---|---|---|---|---|
| `indic_tiny` | `sulabhkatiyar/indic-tiny-tts-gujarati` | 22.5M / ~90 MB ONNX | weights CC-BY-4.0, code MIT | male + female, 7× realtime on x86, Gujarati script only; numbers/phones must be written in words |
| `mithi` | `Oomni/mithi-v2-flash` | 99.1M / 199 MB | Apache-2.0 | 10 voices, 11 languages incl. `gu`, ~3 s per 7 s sentence on 4 CPU threads |
| `pocket` | `meeeetxd/pocket-tts-gujarati` | ~100M / 438 MB | CC-BY-4.0 (base MIT) | voice cloning from short WAV, ~200 ms first chunk, 80 ms streaming frames |
| `piper` | `Arjun4707/piper-gujarati-male` | ~63 MB ONNX | Apache-2.0 | male only, gated (accept HF conditions), realtime on CPU |

Avoid for commercial use: `facebook/mms-tts-guj` (CC BY-NC 4.0), Piper `gu_IN-nita` (CC BY-NC-SA 4.0).

## STT

| Backend | Repo | Size | License | Notes |
|---|---|---|---|---|
| `whisper_base` | `vasista22/whisper-gujarati-base` | ~145 MB | Apache-2.0 | WER 18.98% FLEURS; use via faster-whisper/CT2 |
| `whisper_small` | `vasista22/whisper-gujarati-small` | ~480 MB | Apache-2.0 | WER 14.73% FLEURS |
| `whisper_medium_ct2` | `managergil/ct2-whisper-gujarati-medium` | ~2.9 GB INT8 | Apache-2.0 | WER 12.33%, ~22 s per 1 min audio on CPU |
| `indicconformer` | `Docglasses-AI/indic-conformer-600m-sherpa-onnx-int8` (gu file) | ~659 MB | MIT | offline CTC, WER 27.2% on medical dialogues; ~0.1x RTF on phone, faster on PC |

Note: Whisper needs a CT2 export for fastest CPU inference. `ukta-app/whisper-gujarati-ct2` is a ready small CT2 conversion.

## LLM (answer generation)

| Backend | Repo | Quantized size | License | Notes |
|---|---|---|---|---|
| `qwen_0_5b` | `Qwen/Qwen2.5-0.5B-Instruct-GGUF` | ~0.3 GB Q4 | Apache-2.0 | ~27 tok/s CPU, weak reasoning, fast |
| `qwen_1_5b` | `Qwen/Qwen2.5-1.5B-Instruct-GGUF` | ~0.9 GB Q4 | Apache-2.0 | ~9 tok/s CPU, good structured output |
| `gemma_3_1b` | `google/gemma-3-1b-it` (GGUF) | ~0.6 GB Q4 | Gemma terms | ~18 tok/s CPU, multilingual |
| `kemcho_gemma` | `shalinm/Kemcho-Gemma-3-1B-IT` | ~4 GB bf16 | base Gemma terms | Gujarati instruction fine-tune (Alpaca-Gujarati ~10k), best Gujarati candidate |

For grounded answers, 1B–1.5B is the realistic CPU tier. The Gujarati fine-tune
is the one to watch for tone; Qwen 1.5B is the speed/JSON baseline.

## Recommended test order

1. TTS: `indic_tiny` → `mithi` → `pocket` → `piper`
2. STT: `whisper_small` → `whisper_medium_ct2` → `indicconformer`
3. LLM: `qwen_1_5b` → `kemcho_gemma` → `qwen_0_5b`

Judge with native Gujarati listeners on: conversational sentences, mixed
English words, brand names, numbers, and phone numbers.
