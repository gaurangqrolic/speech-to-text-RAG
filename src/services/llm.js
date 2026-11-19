import { GoogleGenAI } from "@google/genai";
import { config } from "../config.js";

const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });

/**
 * Build the system prompt. When RAG context chunks are available they are
 * injected here so the model grounds its answer in the knowledge base.
 */
function buildSystemPrompt(context = []) {
  const persona = [
    `You are ${config.assistant.name}, a friendly voice assistant for Gujarati-speaking users.`,
    `Always reply in Gujarati (ગુજરાતી) using the Gujarati script.`,
    "Keep replies conversational, natural and concise (2-4 sentences) because they are spoken aloud.",
    "Never use markdown, bullet points, emoji or code blocks — plain sentences only.",
    "If you do not know the answer, say so honestly in Gujarati instead of guessing.",
  ];

  if (context.length > 0) {
    persona.push(
      "",
      "Use the following knowledge base excerpts to answer. Base your answer on them when relevant:",
      ...context.map((chunk, i) => `[${i + 1}] ${chunk}`)
    );
  }

  return persona.join("\n");
}

/**
 * Generate a Gujarati text reply for the user's message.
 *
 * Stateless conversation mode: the caller passes previously stored `steps`
 * (from earlier turns) so history is kept on our side, not Google's.
 *
 * @param {object} params
 * @param {string} params.userText - User's message (transcribed speech).
 * @param {string[]} [params.context] - RAG knowledge-base chunks.
 * @param {Array<object>} [params.historySteps] - Steps from previous turns.
 * @returns {Promise<{ text: string, steps: Array<object> }>}
 */
export async function generateReply({ userText, context = [], historySteps = [] }) {
  const input = [
    ...historySteps,
    { type: "user_input", content: [{ type: "text", text: userText }] },
  ];

  const interaction = await ai.interactions.create({
    model: config.gemini.model,
    input,
    store: false,
    system_instruction: buildSystemPrompt(context),
    generation_config: { max_output_tokens: 1024 },
  });

  return {
    text: (interaction.output_text ?? "").trim(),
    steps: interaction.steps ?? [],
  };
}
