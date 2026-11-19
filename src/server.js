import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, agentConfigured } from "./config.js";
import sarvamProxy from "./routes/sarvamProxy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

app.disable("x-powered-by");
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, agent_configured: agentConfigured() });
});

// Non-secret agent identifiers for the frontend.
app.get("/api/config", (_req, res) => {
  res.json({
    org_id: config.agent.orgId,
    workspace_id: config.agent.workspaceId,
    app_id: config.agent.appId,
    configured: agentConfigured(),
  });
});

// Sarvam key proxy — the only place the API key is used.
app.use("/api/sarvam", sarvamProxy);

app.use((err, _req, res, _next) => {
  console.error("[server] error:", err);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

app.listen(config.port, () => {
  console.log(`Qrolic voice assistant running at http://localhost:${config.port}`);
  if (agentConfigured()) {
    console.log(`  agent: org=${config.agent.orgId} workspace=${config.agent.workspaceId} app=${config.agent.appId}`);
  } else {
    console.log("  ⚠ agent not configured — set SAMVAAD_ORG_ID / SAMVAAD_WORKSPACE_ID / SAMVAAD_APP_ID in .env");
  }
});
