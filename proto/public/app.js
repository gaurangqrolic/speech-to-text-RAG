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

async function run(payload) {
  if (busy) return;
  busy = true;
  $("status").textContent = "thinking…";
  setError("");
  try {
    const res = await fetch("/api/voice/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, sessionId }),
    });
    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(
        `HTTP ${res.status} — non-JSON response${raw ? `: ${raw.slice(0, 300)}` : " (empty body; the tunnel may have timed out)"}`
      );
    }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    // A partial failure (e.g. TTS rate limit) still returns all earlier stages.
    if (data.error) setError(data.error);

    $("transcript").textContent = data.transcript || "—";
    $("sttRaw").textContent =
      data.sttRaw ?? "(text input — STT was skipped)";
    $("answer").textContent = data.answer || "—";
    $("query").textContent =
      `search query: ${data.englishQuery}\n` +
      `spoken as: ${data.spokenText || data.answer}\n` +
      `turn: ${data.grounded === null ? "?" : data.grounded ? "grounded" : "ungrounded"}` +
      ` · context: ${data.contextTurns || 0} prior turn(s)` +
      `${data.timings?.cached ? " · cached" : ""}`;
    $("timings").textContent = `timings: ${JSON.stringify(data.timings)}`;
    $("cost").textContent = `cost (${data.ttsProvider || "?"}): ${JSON.stringify(data.cost)} (approx, INR)`;
    $("chunks").textContent =
      data.chunks?.length
        ? data.chunks
            .map((c, i) => `#${i + 1} ${c.file} (score ${c.score})\n${c.text}`)
            .join("\n\n---\n\n")
        : "no chunks retrieved";

    if (data.audio) {
      const player = $("player");
      player.src = `data:audio/wav;base64,${data.audio}`;
      player.classList.remove("hidden");
      await player.play().catch(() => {});
    }
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
