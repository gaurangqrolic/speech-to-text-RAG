import {
  ConversationAgent,
  BrowserAudioInterface,
  InteractionType,
  AgentState,
} from "sarvam-conv-ai-sdk/browser";

// --- DOM ---
const els = {
  startBtn: document.getElementById("startBtn"),
  muteBtn: document.getElementById("muteBtn"),
  statePill: document.getElementById("statePill"),
  banner: document.getElementById("banner"),
  messages: document.getElementById("messages"),
  level: document.getElementById("level"),
  lastEvent: document.getElementById("lastEvent"),
  error: document.getElementById("error"),
  oneShot: document.getElementById("oneShot"),
};

// Stable anonymous user id (shown in Samvaad Log Analyser).
let userId = localStorage.getItem("voice_user_id");
if (!userId) {
  userId = crypto.randomUUID();
  localStorage.setItem("voice_user_id", userId);
}

let agent = null;
let answerTimer = null; // one-shot mode: end session shortly after the agent's answer
let userSpoke = false;  // ignore the greeting when deciding to auto-end

function setState(state) {
  const labels = {
    idle: "idle",
    connecting: "connecting…",
    connected: "connected",
    listening: "🎤 listening — speak now",
    speaking: "🔊 agent speaking",
    error: "error",
  };
  els.statePill.textContent = labels[state] ?? state;
  els.statePill.dataset.state = state;
  const active = state !== AgentState.IDLE && state !== AgentState.ERROR;
  els.startBtn.textContent = active ? "⏹ End call" : "🎙 Start conversation";
  els.muteBtn.disabled = !active;
  if (state === AgentState.IDLE) {
    els.muteBtn.textContent = "Mute";
  }
}

function addMessage(role, content) {
  const row = document.createElement("div");
  row.className = `msg ${role === "user" ? "user" : "bot"}`;
  const who = document.createElement("span");
  who.className = "who";
  who.textContent = role === "user" ? "You" : "Agent";
  const text = document.createElement("span");
  text.className = "text";
  text.textContent = content;
  row.append(who, text);
  els.messages.appendChild(row);
  els.messages.scrollTop = els.messages.scrollHeight;
}

function showError(message) {
  els.error.textContent = message || "";
  els.error.hidden = !message;
}

function onEvent(event) {
  const name = event?.name || event?.type || "";
  if (name) els.lastEvent.textContent = `last event: ${name}`;
  if (name === "barge-in") els.lastEvent.textContent = "last event: barge-in (you interrupted)";
}

async function start() {
  showError("");
  userSpoke = false;
  clearTimeout(answerTimer);
  els.startBtn.disabled = true;
  try {
    const res = await fetch("/api/config");
    const cfg = await res.json();
    if (!cfg.configured) {
      throw new Error(
        "Agent not configured. Set SAMVAAD_API_KEY, SAMVAAD_ORG_ID, SAMVAAD_WORKSPACE_ID and SAMVAAD_APP_ID in .env"
      );
    }

    const audioInterface = new BrowserAudioInterface(16000, { prebufferMs: 400 });

    agent = new ConversationAgent({
      // Key stays server-side: proxy at /api/sarvam injects it.
      apiKey: "",
      baseUrl: "/api/sarvam/",
      config: {
        org_id: cfg.org_id,
        workspace_id: cfg.workspace_id,
        app_id: cfg.app_id,
        user_identifier: userId,
        user_identifier_type: "custom",
        interaction_type: InteractionType.CALL,
        input_sample_rate: 16000,
        output_sample_rate: 16000,
        // Runtime greeting from our server — overrides the agent's fixed intro
        // without needing a new committed agent version.
        ...(cfg.greeting ? { initial_bot_message: cfg.greeting } : {}),
        // Pin a committed version when SAMVAAD_APP_VERSION is set in .env.
        ...(cfg.app_version ? { version: cfg.app_version } : {}),
      },
      audioInterface,
      stateCallback: (state) => setState(state),
      transcriptCallback: (msg) => {
        addMessage(msg.role, msg.content);
        if (msg.role === "user") {
          userSpoke = true;
          return;
        }
        // One-shot mode: close the session after the agent replies to a real
        // question — but never auto-end on the greeting itself.
        if (els.oneShot.checked && msg.role === "bot" && userSpoke) {
          clearTimeout(answerTimer);
          answerTimer = setTimeout(() => stop(), 1200);
        }
      },
      audioLevelCallback: (level) => {
        // SDK reports both mic input (while listening) and agent output (while speaking).
        const pct = Math.max(0, Math.min(100, (level?.rms ?? 0) * 1000));
        els.level.style.width = `${pct}%`;
        els.level.dataset.direction = level?.direction === "input" ? "input" : "output";
        els.lastEvent.textContent =
          level?.direction === "input"
            ? `mic level ${Math.round(pct)}% — audio is reaching the agent`
            : `agent audio level ${Math.round(pct)}%`;
      },
      eventCallback: onEvent,
      endCallback: () => {
        agent = null;
        setState(AgentState.IDLE);
        els.level.style.width = "0%";
        els.lastEvent.textContent = "session ended";
      },
    });

    setState(AgentState.CONNECTING);
    await agent.start();
    const connected = await agent.waitForConnect(10);
    if (!connected) throw new Error("Could not connect within 10 seconds");
  } catch (err) {
    console.error(err);
    showError(err.message || String(err));
    if (agent) {
      await agent.stop().catch(() => {});
      agent = null;
    }
    setState(AgentState.IDLE);
  } finally {
    els.startBtn.disabled = false;
  }
}

async function stop() {
  clearTimeout(answerTimer);
  if (!agent) return;
  const current = agent;
  agent = null;
  await current.stop().catch(() => {});
  setState(AgentState.IDLE);
  els.level.style.width = "0%";
  els.lastEvent.textContent = "session ended";
}

els.startBtn.addEventListener("click", () => {
  if (agent) stop();
  else start();
});

els.muteBtn.addEventListener("click", () => {
  if (!agent) return;
  if (agent.isMuted()) {
    agent.unmute();
    els.muteBtn.textContent = "Mute";
  } else {
    agent.mute();
    els.muteBtn.textContent = "Unmute";
  }
});

window.addEventListener("beforeunload", () => {
  agent?.stop().catch(() => {});
});

// Surface setup state on load.
fetch("/api/config")
  .then((r) => r.json())
  .then((cfg) => {
    if (!cfg.configured) {
      els.banner.hidden = false;
    }
  })
  .catch(() => {});

setState(AgentState.IDLE);
