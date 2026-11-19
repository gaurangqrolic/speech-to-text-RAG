import "dotenv/config";

if (!process.env.SAMVAAD_API_KEY) {
  throw new Error(
    "Missing required environment variable: SAMVAAD_API_KEY\n" +
      "Copy .env.example to .env and add your Sarvam Voice Agents API key."
  );
}

export const config = {
  port: Number(process.env.PORT) || 3000,

  sarvam: {
    // Voice Agents API key — stays on the server, injected into proxied requests.
    apiKey: process.env.SAMVAAD_API_KEY,
    runtimeBaseUrl:
      process.env.SAMVAAD_RUNTIME_BASE_URL || "https://apps.sarvam.ai/api/app-runtime/",
  },

  agent: {
    // Non-secret identifiers, exposed to the browser via GET /api/config.
    orgId: process.env.SAMVAAD_ORG_ID || "",
    workspaceId: process.env.SAMVAAD_WORKSPACE_ID || "",
    appId: process.env.SAMVAAD_APP_ID || "",
  },

  // Simple in-memory limiter for the key proxy (requests per minute per IP).
  proxyRateLimit: 60,
};

export function agentConfigured() {
  return Boolean(config.agent.orgId && config.agent.workspaceId && config.agent.appId);
}
