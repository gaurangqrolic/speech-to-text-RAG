/**
 * Runtime greeting for the voice session.
 *
 * Samvaad's agent has a fixed intro message, but the Web SDK can override it
 * per session via `initial_bot_message` in the interaction-start message.
 * That lets us change the greeting without committing a new agent version.
 */

const BASE = "તમે ક્રોલિક ટેકનોલોજીસ સાથે વાત કરી રહ્યા છો. આજે હું તમારી શું મદદ કરી શકું?";

/** Greeting by Indian Standard Time hour. */
export function greetingForDate(date = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      hour12: false,
    }).format(date)
  );

  let prefix;
  if (hour >= 5 && hour < 12) prefix = "સુપ્રભાત!";
  else if (hour >= 12 && hour < 17) prefix = "નમસ્તે!";
  else if (hour >= 17 && hour < 21) prefix = "શુભ સાંજ!";
  else prefix = "નમસ્તે!";

  return `${prefix} ${BASE}`;
}

export function greetingFromEnv(override) {
  const value = override?.trim();
  // "OFF" = silent start: skip initial_bot_message so the agent just listens.
  if (value && value.toUpperCase() === "OFF") return null;
  return value || greetingForDate();
}
