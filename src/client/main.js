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
};

// Stable anonymous user id (shown in Samvaad Log Analyser).
let userId = localStorage.getItem("voice_user_id");
if (!userId) {
  userId = crypto.randomUUID();
  localStorage.setItem("voice_user_id", userId);
}

let agent = null;

function setState(state) {
  els.statePill.textContent = state;
  els.statePill.dataset.state = state;
  const active = state !== AgentState.IDLE && state !== AgentState.ERROR;
  els.startBtn.textContent = active ? "⏹ Stop" : "🎙 Start conversation";
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
      },
      audioInterface,
      stateCallback: (state) => setState(state),
      transcriptCallback: (msg) => addMessage(msg.role, msg.content),
      audioLevelCallback: (level) => {
        const pct = Math.max(0, Math.min(100, (level?.rms ?? 0) * 300));
        els.level.style.width = `${pct}%`;
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
  if (!agent) return;
  const current = agent;
  agent = null;
  await current.stop().catch(() => {});
  setState(AgentState.IDLE);
  els.level.style.width = "0%";
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
