import { Router } from "express";
import { config } from "../config.js";

/**
 * Key proxy for the Sarvam Samvaad Web SDK.
 *
 * The browser SDK is configured with `baseUrl: "/api/sarvam/"` and an empty
 * apiKey. On session start it calls:
 *
 *   GET {baseUrl}orgs/{org}/workspaces/{ws}/apps/{app}/url?interaction_type=...
 *   Header: X-API-Key: (empty)
 *
 * This proxy validates the path, injects the real API key server-side, and
 * forwards the request to Sarvam's app-runtime endpoint. The SDK receives the
 * short-lived signed WebSocket URL and connects directly — the API key never
 * reaches the browser.
 */

const router = Router();

// Only the signed-URL endpoint may be proxied (prevents open-proxy key abuse).
const SIGNED_URL_PATH =
  /^\/orgs\/[A-Za-z0-9_-]+\/workspaces\/[A-Za-z0-9_-]+\/apps\/[A-Za-z0-9_-]+\/url$/;

// --- tiny per-IP rate limiter (sliding 60s window) ---
const hits = new Map(); // ip -> { count, resetAt }

function rateLimited(ip) {
  const now = Date.now();
  if (hits.size > 10_000) {
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
  }
  let entry = hits.get(ip);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + 60_000 };
    hits.set(ip, entry);
  }
  entry.count += 1;
  return entry.count > config.proxyRateLimit;
}

router.use((req, res) => {
  if (rateLimited(req.ip)) {
    return res.status(429).json({ error: "Too many requests. Try again in a minute." });
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // req.url is the path after the /api/sarvam mount, including the query string.
  const pathOnly = req.url.split("?")[0];
  if (!SIGNED_URL_PATH.test(pathOnly)) {
    return res.status(404).json({ error: "Not found" });
  }

  const upstream = `${config.sarvam.runtimeBaseUrl}${req.url.replace(/^\//, "")}`;

  (async () => {
    const response = await fetch(upstream, {
      method: "GET",
      headers: {
        "X-API-Key": config.sarvam.apiKey,
        Accept: "application/json",
      },
    });

    const body = Buffer.from(await response.arrayBuffer());
    res.status(response.status);
    res.set(
      "content-type",
      response.headers.get("content-type") || "application/json"
    );
    res.send(body);
  })().catch((err) => {
    console.error("[proxy] upstream error:", err.message);
    res.status(502).json({ error: "Failed to reach Sarvam voice service" });
  });
});

export default router;
