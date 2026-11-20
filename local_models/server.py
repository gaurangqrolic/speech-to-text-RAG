#!/usr/bin/env python3
"""Local-model benchmark server (stdlib only; backends imported lazily).

Endpoints:
  GET  /health
  GET  /models
  POST /tts   {backend, text, voice?, speed?}          -> WAV bytes
  POST /stt   {backend, audio_path | audio_b64, ...}   -> JSON
  POST /llm   {backend, system?, prompt, max_tokens?}  -> JSON
"""
import base64
import io
import json
import os
import sys
import tempfile
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONFIG = json.loads((ROOT / "config.json").read_text())
CACHE = {}
MODEL_DIR = ROOT / "models"
MODEL_DIR.mkdir(exist_ok=True)


def cached(key, factory):
    if key not in CACHE:
        CACHE[key] = factory()
    return CACHE[key]


def error(message, status=400):
    return {"ok": False, "error": message}, status


def wav_bytes(audio, sample_rate=24000):
    import numpy as np
    import soundfile as sf

    buf = io.BytesIO()
    sf.write(buf, np.asarray(audio).squeeze(), sample_rate, format="WAV")
    return buf.getvalue()


def digits_to_gujarati(text):
    """Indic Tiny TTS reads digits as numbers; spell them for phone numbers."""
    words = {
        "0": "શૂન્ય", "1": "એક", "2": "બે", "3": "ત્રણ", "4": "ચાર",
        "5": "પાંચ", "6": "છ", "7": "સાત", "8": "આઠ", "9": "નવ",
    }
    return "".join(words.get(c, c) for c in str(text))


def read_audio(payload):
    if payload.get("audio_path"):
        return str(payload["audio_path"])
    if not payload.get("audio_b64"):
        raise ValueError("provide audio_path or audio_b64")
    raw = base64.b64decode(payload["audio_b64"])
    suffix = payload.get("suffix", ".wav")
    path = MODEL_DIR / f"input_{int(time.time()*1000)}{suffix}"
    path.write_bytes(raw)
    return str(path)


# --------------------------------------------------------------------------- TTS
def tts_backend(name):
    cfg = CONFIG["tts"][name]
    runner = cfg["runner"]

    if runner == "indic_tiny":
        from huggingface_hub import snapshot_download

        def build():
            folder = snapshot_download(cfg["repo"], ignore_patterns=["*.safetensors"])
            sys.path.insert(0, folder)
            from indic_tiny_tts import TinyTTSOnnx
            return TinyTTSOnnx.from_pretrained(folder)

        tts = cached(f"tts:{name}", build)
        def run(text, voice, opts):
            return wav_bytes(
                tts.synthesize(digits_to_gujarati(text), voice=voice or "female", speed=opts.get("speed", 1.0)),
                24000,
            )
        return run

    if runner == "mithi":
        from huggingface_hub import snapshot_download

        def build():
            folder = snapshot_download(cfg["repo"])
            sys.path.insert(0, folder)
            os.chdir(folder)
            from run import Mithi
            return Mithi(device="cpu")

        tts = cached(f"tts:{name}", build)
        def run(text, voice, opts):
            audio = tts.synthesize(text, lang="gu", voice=voice or "vaidehi")
            return wav_bytes(audio, 24000)
        return run

    if runner == "pocket":
        from huggingface_hub import snapshot_download

        def build():
            folder = snapshot_download(cfg["repo"])
            os.chdir(folder)
            from pocket_tts import TTSModel
            return TTSModel.load_model(config="config.yaml")

        tts = cached(f"tts:{name}", build)
        def run(text, voice, opts):
            if not voice:
                raise ValueError("pocket TTS needs a reference WAV path in 'voice'")
            state = tts.get_state_for_audio_prompt(voice)
            audio = tts.generate_audio(state, text)
            return wav_bytes(audio.detach().cpu().numpy().squeeze(), tts.sample_rate)
        return run

    if runner == "piper":
        import subprocess
        from huggingface_hub import hf_hub_download

        def run(text, voice, opts):
            model = hf_hub_download(cfg["repo"], "gu_epoch229.onnx")
            out = MODEL_DIR / f"piper_{int(time.time()*1000)}.wav"
            proc = subprocess.run(
                ["piper", "--model", model, "--output_file", str(out)],
                input=text.encode(), capture_output=True,
            )
            if proc.returncode:
                raise RuntimeError(proc.stderr.decode()[:300])
            return out.read_bytes()
        return run

    raise ValueError(f"unknown TTS runner: {runner}")


# --------------------------------------------------------------------------- STT
def stt_backend(name):
    cfg = CONFIG["stt"][name]
    runner = cfg["runner"]

    if runner == "faster_whisper":
        import subprocess
        from faster_whisper import WhisperModel

        def build_whisper():
            try:
                return WhisperModel(cfg["repo"], device="cpu", compute_type="int8")
            except RuntimeError as exc:
                if "model.bin" not in str(exc):
                    raise
                # Raw Transformers checkpoint: convert to CTranslate2 once.
                converted = MODEL_DIR / f"ct2_{name}"
                if not (converted / "model.bin").exists():
                    subprocess.run(
                        [
                            "ct2-transformers-converter",
                            "--model", cfg["repo"],
                            "--output_dir", str(converted),
                            "--quantization", "int8",
                            "--copy_files", "tokenizer.json", "preprocessor_config.json",
                        ],
                        check=True,
                    )
                return WhisperModel(str(converted), device="cpu", compute_type="int8")

        model = cached(f"stt:{name}", build_whisper)
        def run(path, opts):
            segments, info = model.transcribe(path, language="gu", beam_size=opts.get("beam_size", 1))
            return {"text": "".join(s.text for s in segments).strip(), "language": info.language}
        return run

    if runner == "sherpa_onnx":
        import numpy as np
        import sherpa_onnx
        import soundfile as sf
        from huggingface_hub import hf_hub_download

        def build():
            model = hf_hub_download(cfg["repo"], cfg["file"])
            tokens = hf_hub_download(cfg["repo"], cfg["tokens"])
            return sherpa_onnx.OfflineRecognizer.from_nemo_ctc(
                model=model, tokens=tokens, num_threads=opts_threads(),
                decoding_method="greedy_search",
            )

        def opts_threads():
            return int(os.getenv("LOCAL_NUM_THREADS", "4"))

        rec = cached(f"stt:{name}", build)
        def run(path, opts):
            samples, sr = sf.read(path, dtype="float32")
            stream = rec.create_stream()
            stream.accept_waveform(sr, np.asarray(samples))
            rec.decode_stream(stream)
            return {"text": stream.result.text.strip(), "sample_rate": sr}
        return run

    raise ValueError(f"unknown STT runner: {runner}")


# --------------------------------------------------------------------------- LLM
def llm_backend(name):
    cfg = CONFIG["llm"][name]
    runner = cfg["runner"]

    if runner == "llama_cpp":
        from huggingface_hub import hf_hub_download
        from llama_cpp import Llama

        def build():
            path = hf_hub_download(cfg["repo"], cfg["file"])
            return Llama(model_path=path, n_ctx=2048, n_threads=int(os.getenv("LOCAL_NUM_THREADS", "4")))

        llm = cached(f"llm:{name}", build)
        def run(payload):
            result = llm.create_chat_completion(
                messages=payload["messages"],
                max_tokens=payload.get("max_tokens", 160),
                temperature=payload.get("temperature", 0.2),
            )
            return {"text": result["choices"][0]["message"]["content"].strip()}
        return run

    if runner == "transformers":
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        def build():
            tok = AutoTokenizer.from_pretrained(cfg["repo"])
            model = AutoModelForCausalLM.from_pretrained(
                cfg["repo"], torch_dtype=torch.float32, device_map="cpu"
            )
            return tok, model

        tok, model = cached(f"llm:{name}", build)
        def run(payload):
            inputs = tok.apply_chat_template(payload["messages"], add_generation_prompt=True, return_tensors="pt")
            with torch.no_grad():
                out = model.generate(inputs, max_new_tokens=payload.get("max_tokens", 160), do_sample=False)
            text = tok.decode(out[0][inputs.shape[-1]:], skip_special_tokens=True)
            return {"text": text.strip()}
        return run

    raise ValueError(f"unknown LLM runner: {runner}")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print("[local] " + fmt % args, file=sys.stderr)

    def send_json(self, obj, status=200):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_audio(self, data):
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length) or b"{}")

    def do_GET(self):
        if self.path == "/health":
            return self.send_json({"ok": True, "loaded": list(CACHE), "models_dir": str(MODEL_DIR)})
        if self.path == "/models":
            return self.send_json(CONFIG)
        return self.send_json(*error("not found", 404))

    def do_POST(self):
        try:
            payload = self.body()
            started = time.time()
            if self.path == "/tts":
                name = payload["backend"]
                audio = tts_backend(name)(payload["text"], payload.get("voice"), payload)
                self.send_audio(audio)
                return
            if self.path == "/stt":
                name = payload["backend"]
                path = read_audio(payload)
                result = stt_backend(name)(path, payload)
                result["seconds"] = round(time.time() - started, 3)
                return self.send_json(result)
            if self.path == "/llm":
                name = payload["backend"]
                messages = payload.get("messages")
                if not messages:
                    messages = []
                    if payload.get("system"):
                        messages.append({"role": "system", "content": payload["system"]})
                    messages.append({"role": "user", "content": payload["prompt"]})
                result = llm_backend(name)({**payload, "messages": messages})
                result["seconds"] = round(time.time() - started, 3)
                return self.send_json(result)
            return self.send_json(*error("not found", 404))
        except Exception as exc:
            self.send_json(*error(f"{type(exc).__name__}: {exc}", 500))


if __name__ == "__main__":
    port = int(os.getenv("LOCAL_MODELS_PORT", "4000"))
    print(f"Local model benchmark server at http://localhost:{port}")
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
