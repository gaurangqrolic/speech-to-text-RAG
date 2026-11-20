#!/usr/bin/env python3
"""Run the same test cases through each local backend and save comparable results."""
import argparse
import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CASES = json.loads((ROOT / "test_cases.json").read_text())


def post(url, payload):
    data = json.dumps(payload, ensure_ascii=False).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    started = time.time()
    try:
        with urllib.request.urlopen(req, timeout=900) as res:
            body = res.read()
            ctype = res.headers.get("Content-Type", "")
            return {
                "ok": True,
                "seconds": round(time.time() - started, 3),
                "content_type": ctype,
                "body": body,
            }
    except urllib.error.HTTPError as exc:
        return {
            "ok": False,
            "seconds": round(time.time() - started, 3),
            "error": exc.read().decode()[:500],
        }


def run(args):
    task = args.task
    backends = args.backends.split(",") if args.backends else {
        "tts": ["indic_tiny", "mithi", "pocket", "piper"],
        "stt": ["whisper_small", "whisper_medium_ct2", "indicconformer"],
        "llm": ["qwen_1_5b", "kemcho_gemma", "qwen_0_5b"],
    }[task]

    out_dir = ROOT / "results" / datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = []

    for backend in backends:
        for case in CASES[task]:
            if task == "tts":
                payload = {"backend": backend, "text": case["text"], "voice": args.voice}
            elif task == "stt":
                if not case.get("audio_path"):
                    print(f"skip {backend}/{case['id']}: no audio_path")
                    continue
                payload = {"backend": backend, "audio_path": case["audio_path"]}
            else:
                payload = {
                    "backend": backend,
                    "system": case.get("system", ""),
                    "prompt": case["prompt"],
                    "max_tokens": 160,
                }

            res = post(f"{args.url}/{task}", payload)
            row = {
                "task": task,
                "backend": backend,
                "case": case["id"],
                "ok": res["ok"],
                "seconds": res["seconds"],
            }

            if task == "tts" and res["ok"]:
                wav = out_dir / f"{task}_{backend}_{case['id']}.wav"
                wav.write_bytes(res["body"])
                row["output"] = str(wav.relative_to(ROOT))
            else:
                text = res.get("body", b"").decode(errors="replace") if res["ok"] else res["error"]
                if res.get("content_type", "").startswith("application/json") or task != "tts":
                    try:
                        row.update(json.loads(text))
                    except Exception:
                        row["text"] = text[:500]
            rows.append(row)
            status = "OK" if res["ok"] else "FAIL"
            print(f"[{status}] {backend:20} {case['id']:15} {res['seconds']:6.2f}s")

    report = out_dir / f"{task}_results.json"
    report.write_text(json.dumps(rows, ensure_ascii=False, indent=2))
    print(f"\nSaved {report.relative_to(ROOT)}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--task", choices=["tts", "stt", "llm"], required=True)
    p.add_argument("--backends")
    p.add_argument("--voice", default=None, help="TTS voice override")
    p.add_argument("--url", default="http://localhost:4000")
    run(p.parse_args())
