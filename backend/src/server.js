import "dotenv/config";

// Required on some Windows machines where corporate/antivirus proxies
// interfere with TLS certificate validation for outbound API calls
process.env.NODE_TLS_REJECT_UNAUTHORIZED = process.env.NODE_TLS_REJECT_UNAUTHORIZED || "0";

import cors from "cors";
import express from "express";
import helmet from "helmet";
import { AgentOrchestrator } from "./agent/orchestrator.js";
import { ConversationMemory } from "./agent/memory.js";
import { loadProductDB } from "./data/scraper.js";
import { vectorStore } from "./data/vector-store.js";
import { apiLimiter, chatLimiter, healthLimiter } from "./middleware/rateLimiter.js";
import { validateChatRequest } from "./middleware/inputValidators.js";
import productController from "./controllers/productController.js";
import feedbackController from "./controllers/feedbackController.js";
import logger from "./utils/logger.js";

const app = express();
const PORT = process.env.PORT || 4000;

// Trust proxy — required when deployed behind Render/Vercel/Heroku load balancers
// This fixes the express-rate-limit X-Forwarded-For warning
app.set("trust proxy", 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // disabled for dev; enable in prod
}));
app.use(cors({
  origin: (origin, callback) => {
    // Allow: no origin (mobile apps, curl), localhost, and configured origins
    if (!origin) return callback(null, true);
    const allowed = process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(",").map(s => s.trim())
      : [];
    // Always allow localhost and vercel/render domains
    if (
      origin.includes("localhost") ||
      origin.includes("vercel.app") ||
      origin.includes("onrender.com") ||
      allowed.includes(origin)
    ) {
      return callback(null, true);
    }
    callback(null, true); // Allow all for now — tighten in production
  },
  credentials: true,
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Session-ID"],
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.path}`, { ip: req.ip });
  next();
});

// Apply rate limiting
app.use("/api", apiLimiter);

// Session store
const sessions = new Map();
function getOrCreateSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      memory: new ConversationMemory(),
      orchestrator: new AgentOrchestrator(),
    });
  }
  return sessions.get(sessionId);
}

// Cleanup stale sessions every 30 min
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, s] of sessions) {
    if (s.memory.lastActivity < cutoff) sessions.delete(id);
  }
}, 30 * 60 * 1000);

// ── Route: Product REST API ─────────────────────────────────────────────────
app.use("/api/products", productController);

// ── Route: Feedback ─────────────────────────────────────────────────────────
app.use("/api/feedback", feedbackController);

// ── Route: Chat (standard JSON) ─────────────────────────────────────────────
app.post("/api/chat", chatLimiter, validateChatRequest, async (req, res) => {
  const { query, sessionId = "default" } = req.body;
  try {
    const session = getOrCreateSession(sessionId);
    const response = await session.orchestrator.handleQuery(query.trim(), session.memory);
    logger.info(`Chat response: intent=${response.meta?.intent || "—"}, cards=${response.cards?.length || 0}`);
    return res.json(response);
  } catch (err) {
    logger.error("Chat error:", err);
    return res.status(500).json({
      content: "I had trouble with that. Please try again.",
      cards: [], suggestions: [], toolsUsed: [],
      meta: { error: true },
    });
  }
});

// ── Route: Chat (SSE streaming) ──────────────────────────────────────────────
app.post("/api/chat/stream", chatLimiter, validateChatRequest, async (req, res) => {
  const { query, sessionId = "default" } = req.body;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    send("status", { message: "Processing your question..." });
    const session = getOrCreateSession(sessionId);
    const response = await session.orchestrator.handleQuery(query.trim(), session.memory);

    // Simulate streaming by sending words progressively
    const words = response.content.split(" ");
    let acc = "";
    for (let i = 0; i < words.length; i += 4) {
      acc += (acc ? " " : "") + words.slice(i, i + 4).join(" ");
      send("content", { text: acc, partial: i + 4 < words.length });
      await new Promise(r => setTimeout(r, 25));
    }
    if (response.cards?.length > 0) send("cards", { cards: response.cards });
    if (response.suggestions?.length > 0) send("suggestions", { suggestions: response.suggestions });
    send("done", { meta: response.meta });
  } catch (err) {
    logger.error("Stream error:", err);
    send("error", { message: "Processing failed. Please try again." });
  }
  res.end();
});

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/health", healthLimiter, async (_req, res) => {
  const db = loadProductDB();
  const { llmProvider } = await import("./agent/llm-provider.js");
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: "3.0.0",
    services: {
      database: {
        status: "connected",
        parts: Object.keys(db.parts || {}).length,
        models: Object.keys(db.models || {}).length,
      },
      vectorStore: {
        status: vectorStore.embeddings.size > 0 ? "loaded" : "empty",
        embeddings: vectorStore.embeddings.size,
      },
      llm: {
        provider: llmProvider.providerName,
        model: llmProvider.model || null,
      },
    },
  });
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({ error: "Route not found", path: req.originalUrl });
});

// Error handler
app.use((err, req, res, _next) => {
  logger.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ── Initialize ─────────────────────────────────────────────────────────────────
async function initialize() {
  logger.info("Initializing PartSelect AI Agent...");

  // Check for API key upfront — give clear error if missing
  const { llmProvider } = await import("./agent/llm-provider.js");
  if (!llmProvider.isAvailable) {
    logger.warn("═══════════════════════════════════════════════════════");
    logger.warn("  NO LLM API KEY CONFIGURED");
    logger.warn("  The agent will use tool-only mode (no AI reasoning).");
    logger.warn("  To enable full AI features, add to backend/.env:");
    logger.warn("    OPENAI_API_KEY=sk-proj-your-key-here");
    logger.warn("  Get a key at: https://platform.openai.com/api-keys");
    logger.warn("═══════════════════════════════════════════════════════");
  }

  let db = loadProductDB();
  let partCount = Object.keys(db.parts || {}).length;

  if (partCount === 0) {
    logger.info("No product database found — running import-data...");
    try {
      // This imports the CSV + models-seed.json (no scraping needed)
      const { run } = await import("./data/import-csv.js");
      if (typeof run === "function") await run();
      db = loadProductDB();
      partCount = Object.keys(db.parts || {}).length;
      logger.info(`Imported ${partCount} products`);
    } catch (err) {
      logger.warn(`Auto-import failed: ${err.message}. Run 'npm run import-data' manually.`);
    }
  } else {
    logger.info(`Found ${partCount} products in local database (${Object.keys(db.models || {}).length} models)`);
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (partCount > 0 && openaiKey && openaiKey.startsWith("sk-")) {
    try {
      await vectorStore.initialize(db.parts);
    } catch (err) {
      logger.warn(`Vector store skipped: ${err.message}`);
    }
  } else {
    logger.info("Vector store skipped — requires OpenAI key (sk-...)");
  }
}

initialize().then(() => {
  app.listen(PORT, () => {
    logger.info(`PartSelect AI Agent running on http://localhost:${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || "development"}`);
  });
}).catch(err => {
  logger.error("Startup failed:", err);
  process.exit(1);
});
