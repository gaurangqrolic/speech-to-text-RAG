const $ = (id) => document.getElementById(id);
let sessionId = sessionStorage.getItem("voice_proto_session");
if (!sessionId) {
  sessionId = crypto.randomUUID();
  sessionStorage.setItem("voice_proto_session", sessionId);
}
let recorder = null;
let chunks = [];
let startedAt = 0;
let busy = false;

function setError(msg) {
  $("error").textContent = msg || "";
  $("error").classList.toggle("hidden", !msg);
  $("copyErrBtn").classList.toggle("hidden", !msg);
}

async function copyText(text, btn, label = "📋 Copied") {
  if (!text || text === "—") return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      // Fallback for browsers without the async clipboard API.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    const old = btn.textContent;
    btn.textContent = label;
    setTimeout(() => (btn.textContent = old), 1500);
  } catch (e) {
    setError(`Could not copy to clipboard: ${e.message}`);
  }
}

$("copyErrBtn").addEventListener("click", () =>
  copyText($("error").textContent, $("copyErrBtn"), "✅ Error copied")
);

$("copyDiagBtn").addEventListener("click", () => {
  const diag = [
    `caller: ${$("transcript").textContent}`,
    `agent: ${$("answer").textContent}`,
    $("query").textContent,
    $("timings").textContent,
    $("cost").textContent,
    `--- STT RAW ---\n${$("sttRaw").textContent}`,
    `--- CHUNKS ---\n${$("chunks").textContent}`,
    `--- ERROR ---\n${$("error").textContent || "(none)"}`,
  ].join("\n\n");
  copyText(diag, $("copyDiagBtn"), "✅ Diagnostics copied");
});

function decodeMeta(res) {
  const b64 = res.headers.get("X-Meta");
  if (!b64) return null;
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

function renderMeta(data) {
  $("transcript").textContent = data.transcript || "—";
  $("sttRaw").textContent = data.sttRaw ?? "(text input — STT was skipped)";
  $("answer").textContent = data.answer || "—";
  $("query").textContent =
    `search query: ${data.englishQuery}\n` +
    `spoken as: ${data.spokenText || data.answer}\n` +
    `turn: ${data.grounded === null ? "?" : data.grounded ? "grounded" : "ungrounded"}` +
    ` · context: ${data.contextTurns || 0} prior turn(s)` +
    `${data.cached ? " · cached" : ""}`;
  $("timings").textContent = `timings: ${JSON.stringify(data.timings)}`;
  $("cost").textContent = `cost (${data.ttsProvider || "?"}): ${JSON.stringify(data.cost)} (approx, INR)`;
  $("chunks").textContent =
    data.chunks?.length
      ? data.chunks
          .map((c, i) => `#${i + 1} ${c.file} (score ${c.score})\n${c.text}`)
          .join("\n\n---\n\n")
      : "no chunks retrieved";
}

function appendBuffer(sb, buf) {
  return new Promise((resolve, reject) => {
    const done = () => {
      sb.removeEventListener("updateend", done);
      resolve();
    };
    sb.addEventListener("updateend", done);
    sb.addEventListener("error", () => reject(new Error("audio decode error")), { once: true });
    try {
      sb.appendBuffer(buf);
    } catch (e) {
      reject(e);
    }
  });
}

async function playStream(res, codec) {
  const player = $("player");
  const mime = codec === "audio/mpeg" ? "audio/mpeg" : "audio/wav";
  const reader = res.body.getReader();
  const pieces = [];

  const canStream =
    window.MediaSource && MediaSource.isTypeSupported(mime) && mime === "audio/mpeg";
  if (!canStream) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pieces.push(value);
    }
    player.src = URL.createObjectURL(new Blob(pieces, { type: mime }));
    player.classList.remove("hidden");
    await player.play().catch(() => {});
    return;
  }

  const mediaSource = new MediaSource();
  player.src = URL.createObjectURL(mediaSource);
  player.classList.remove("hidden");
  await new Promise((r) => mediaSource.addEventListener("sourceopen", r, { once: true }));
  const sb = mediaSource.addSourceBuffer(mime);
  let queue = Promise.resolve();
  let started = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const buf = value instanceof Uint8Array ? value : new Uint8Array(value);
    pieces.push(buf);
    queue = queue.then(() => appendBuffer(sb, buf));
    if (!started) {
      started = true;
      player.play().catch(() => {});
    }
  }
  await queue;
  if (mediaSource.readyState === "open") mediaSource.endOfStream();
}

async function run(payload) {
  if (busy) return;
  busy = true;
  $("status").textContent = "thinking…";
  setError("");
  try {
    const res = await fetch("/api/voice/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, sessionId }),
    });
    if (!res.ok) {
      const raw = await res.text();
      let message = `HTTP ${res.status}`;
      try {
        const j = JSON.parse(raw);
        message = j.error || message;
      } catch {
        if (raw) message += `: ${raw.slice(0, 300)}`;
      }
      throw new Error(message);
    }
    const meta = decodeMeta(res);
    if (!meta) throw new Error("Stream response missing metadata");
    renderMeta(meta);
    if (meta.cached) setError("");
    await playStream(res, meta.audioCodec || "wav");
  } catch (err) {
    setError(err.message);
  } finally {
    busy = false;
    $("status").textContent = "idle";
  }
}

$("askBtn").addEventListener("click", () => {
  const q = $("question").value.trim();
  if (q) run({ question: q });
});

$("question").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("askBtn").click();
});

async function startRecording() {
  if (busy) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    setError("Microphone API not available (use HTTPS or localhost)");
    return;
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
  chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(chunks, { type: "audio/webm" });
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const durationMs = Date.now() - startedAt;
    run({ audio: btoa(binary), mimeType: "audio/webm", durationMs });
  };
  recorder.start();
  startedAt = Date.now();
  $("recBtn").textContent = "⏹ Stop & send";
  $("recBtn").classList.add("recording");
  $("status").textContent = "recording…";
}

function stopRecording() {
  if (recorder && recorder.state !== "inactive") recorder.stop();
  $("recBtn").textContent = "🎙 Hold to speak";
  $("recBtn").classList.remove("recording");
}

$("recBtn").addEventListener("click", () => {
  if (recorder && recorder.state === "recording") stopRecording();
  else startRecording().catch((e) => setError(e.message));
});

fetch("/api/health")
  .then((r) => r.json())
  .then((j) => console.log("[proto] health", j))
  .catch(() => {});
