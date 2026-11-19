/**
 * In-memory conversation store keyed by session id.
 * Keeps Gemini interaction `steps` per session so multi-turn chat history
 * lives on our side (Gemini is called with store: false).
 *
 * TODO: replace with Redis/DB when running multiple server instances.
 */

const TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_SESSIONS = 1000;

const sessions = new Map(); // sessionId -> { steps, updatedAt }

function prune() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.updatedAt > TTL_MS) sessions.delete(id);
  }
  // hard cap to bound memory
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    sessions.delete(oldest);
  }
}

export function getSteps(sessionId) {
  prune();
  return sessions.get(sessionId)?.steps ?? [];
}

export function saveSteps(sessionId, steps) {
  prune();
  const existing = sessions.get(sessionId);
  sessions.set(sessionId, {
    steps: [...(existing?.steps ?? []), ...steps],
    updatedAt: Date.now(),
  });
}

export function clearSession(sessionId) {
  sessions.delete(sessionId);
}
