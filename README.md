# PartSelect AI Chat Agent — Case Study

A full end-to-end AI-powered chat agent for [PartSelect.com](https://www.partselect.com), specializing in **refrigerator** and **dishwasher** replacement parts. Built with a multi-agent architecture, live data scraping (Playwright + Cheerio), vector-based semantic search, provider-agnostic LLM support (Gemini free tier / OpenAI / Ollama), and a modern Next.js frontend.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                       FRONTEND (Next.js 14 + TypeScript + Tailwind CSS)     │
│                                                                              │
│   Hero Suggestions · Tool-Call Badges · Product Cards with Add-to-Cart      │
│   Suggestion Chips · Typing Indicators · SSE Streaming · Responsive         │
│   PartSelect-branded design (blue/orange theme)                              │
└────────────────────────────────┬─────────────────────────────────────────────┘
                                 │ POST /api/chat  (or /api/chat/stream via SSE)
                                 ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                      BACKEND (Express + Node.js)                             │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                   LLM PROVIDER (Provider-Agnostic)                     │  │
│  │                                                                        │  │
│  │  Priority: Gemini 2.5 Flash (FREE) → OpenAI GPT-4o-mini → Ollama     │  │
│  │  Unified interface for tool-calling across all providers               │  │
│  └──────────────────────────┬─────────────────────────────────────────────┘  │
│                              │                                                │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                    ROUTER AGENT (Intent Classification)                │  │
│  │                                                                        │  │
│  │  Pattern-based + entity extraction → 8 intent types                    │  │
│  │  31 automated test cases for routing accuracy                          │  │
│  └──────────────────────────┬─────────────────────────────────────────────┘  │
│                              ▼                                                │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │              ORCHESTRATOR AGENT (ReAct Loop with Function Calling)     │  │
│  │                                                                        │  │
│  │  Multi-step tool execution · Up to 3 reasoning rounds per query        │  │
│  │  Automatic card extraction + suggestion generation + tool badges       │  │
│  └──────────────┬───────────────────────────────────┬─────────────────────┘  │
│                  │                                   │                        │
│  ┌───────────────▼────────────────┐  ┌───────────────▼────────────────────┐  │
│  │        TOOL EXECUTOR            │  │         CONVERSATION MEMORY        │  │
│  │                                 │  │                                    │  │
│  │  7 Tools:                       │  │  • Multi-turn context (20 turns)   │  │
│  │  • search_part                  │  │  • Entity persistence              │  │
│  │  • search_by_model              │  │  • Per-session isolation           │  │
│  │  • check_compatibility          │  │  • Auto-cleanup (1h TTL)           │  │
│  │  • get_installation_guide       │  │                                    │  │
│  │  • troubleshoot_symptom         │  └────────────────────────────────────┘  │
│  │  • search_parts_by_keyword      │                                          │
│  │  • semantic_search              │                                          │
│  └───────────┬─────────────────────┘                                          │
│              │                                                                │
│  ┌───────────▼──────────────────────────────────────────────────────────────┐ │
│  │                      DATA LAYER (4-Tier Resolution)                      │ │
│  │                                                                          │ │
│  │  Tier 1: LOCAL PRODUCT DB (products.json — 18+ seeded products)          │ │
│  │  Tier 2: VECTOR STORE (OpenAI text-embedding-3-small, cosine sim.)       │ │
│  │  Tier 3: LIVE SCRAPING (Playwright for JS/403 bypass, Cheerio fallback)  │ │
│  │  Tier 4: KNOWLEDGE BASE (Curated fallback, always available offline)     │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Key Differentiators

### 1. 1,569 Real Products — Zero Fabricated Data
All product data comes from real PartSelect.com scraping (CSV import + live Cheerio scraper). No hardcoded/fabricated seed data. Every title, MPN, price, and URL is verified against the actual site.

### 2. Provider-Agnostic LLM (OpenAI / Gemini / Ollama)
Switch between OpenAI GPT-4o-mini (recommended, $0.15/1M tokens), Gemini 2.0 Flash (free), or local Ollama by changing one env var. Automatic retry with model cascade on quota errors. Tool-only fallback when all LLMs are down.

### 3. Real YouTube Installation Videos
Extracts actual YouTube video IDs from PartSelect product pages (from embedded thumbnail URLs). No fake or auto-generated video links.

### 4. Live Scraping + Cached DB
Local DB of 1,569 parts for instant responses. Any part NOT in the DB is live-scraped from PartSelect.com in real-time. MPN lookup via PartSelect search. 8 pre-indexed model pages.

### 5. 40 Automated Tests
- 22 intent classification tests (router-agent)
- 9 knowledge base tests
- 9 agent integration tests (full pipeline in tool-only mode)

### 6. Production-Grade Security
Helmet HTTP headers, rate limiting (100 req/15min API, 30/15min chat), input validation (express-validator), Winston structured logging, CORS configuration.

### 7. PartSelect-Branded UI
Real PartSelect logo, teal/gold color scheme from partselect.com, product cards with hover lift, tool-call badges, suggestion chips, smooth animations. Designed to embed directly into PartSelect's website.

### 8. Multi-Agent Architecture
Router Agent (pattern-based intent classifier) → Orchestrator (ReAct loop with OpenAI function calling, up to 3 reasoning rounds) → 7 Tools → 4-tier data resolution (local DB → vector search → live scrape → knowledge base).

---

## Features

| Feature | Implementation |
|---------|---------------|
| Part Lookup | Local DB → Live scrape → KB fallback |
| Model Search | Pre-indexed model pages + live scraping |
| Compatibility Check | Cross-reference part/model lists from multiple sources |
| Installation Guide | Scraped repair stories + curated step-by-step guides |
| Troubleshooting | Symptom → cause → part recommendation pipeline |
| Semantic Search | OpenAI embeddings with cosine similarity |
| Order Support | Direct LLM response with policy data |
| Scope Guard | Pattern + entity-aware off-topic rejection |
| Add to Cart | Interactive cart UI on product cards |
| Tool Badges | Visual indicators of which tools the agent used |
| Hero Suggestions | 6 guided starting cards for new users |
| SSE Streaming | Real-time token streaming endpoint |

---

## Project Structure

```
case_study/
├── backend/
│   ├── package.json
│   ├── .env.example
│   └── src/
│       ├── server.js                    # Express API + SSE + vector store init
│       ├── agents/
│       │   └── router-agent.js          # Intent classification (8 intents, tested)
│       ├── agent/
│       │   ├── llm-provider.js          # Provider-agnostic LLM (Gemini/OpenAI/Ollama)
│       │   ├── orchestrator.js          # ReAct agent loop with multi-provider support
│       │   ├── tools.js                 # 7 function calling tool definitions
│       │   ├── tool-executor.js         # 4-tier data resolution dispatch
│       │   ├── partselect-service.js    # Live Cheerio-based scraping
│       │   ├── knowledge-base.js        # Curated parts + troubleshooting guides
│       │   └── memory.js               # Multi-turn conversation memory
│       ├── data/
│       │   ├── scraper.js              # Cheerio scraper (lightweight, fast)
│       │   ├── playwright-scraper.js   # Playwright scraper (robust, 403 bypass)
│       │   ├── playwright-cli.js       # CLI for Playwright scraper
│       │   ├── scrape-cli.js           # CLI for Cheerio scraper
│       │   ├── seed-db.js             # Curated seed database (18 parts, 4 models)
│       │   ├── vector-store.js        # OpenAI embeddings + cosine similarity
│       │   ├── products.json          # Product database (generated)
│       │   └── embeddings.json        # Vector embeddings (generated)
│       └── __tests__/
│           ├── router-agent.test.js   # 22 tests for intent classification
│           └── knowledge-base.test.js # 9 tests for knowledge base
│
├── frontend/
│   ├── package.json
│   ├── next.config.ts
│   └── src/
│       ├── app/
│       │   ├── layout.tsx             # Root layout with metadata
│       │   ├── page.tsx               # Home page
│       │   └── globals.css            # Tailwind + animations
│       ├── components/
│       │   ├── Header.tsx             # PartSelect-branded header
│       │   ├── ChatWindow.tsx         # Main chat interface
│       │   ├── MessageBubble.tsx      # Markdown-rendered messages
│       │   ├── ProductCardGrid.tsx    # Product cards with Add to Cart
│       │   ├── SuggestionChips.tsx    # Clickable suggestion pills
│       │   ├── TypingIndicator.tsx    # Loading animation
│       │   ├── ToolBadges.tsx         # Agent tool-call indicators
│       │   └── HeroSuggestions.tsx    # 6 guided starting cards
│       └── lib/
│           ├── api.ts                 # Backend API client
│           └── types.ts              # TypeScript interfaces
│
└── README.md
```

---

## Quick Start (5 minutes)

### Prerequisites
- Node.js 18+ ([nodejs.org](https://nodejs.org))
- An **OpenAI API key** — get one at [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
  - Cost: ~$0.15/1M tokens. A full day of testing costs under $1.
  - The app uses `gpt-4o-mini` for tool-calling and response synthesis.

### Step 1 — Backend
```bash
git clone https://github.com/kunjal2002/case_study.git
cd case_study/backend
npm install
```

Create a `.env` file in the `backend/` folder:
```
OPENAI_API_KEY=sk-proj-your-actual-key-here
PORT=4000
```

Then run:
```bash
npm run import-data   # loads 1,600+ real PartSelect products (~3 seconds)
npm run dev           # starts API on http://localhost:4000
```

### Step 2 — Frontend (new terminal)
```bash
cd ../frontend
npm install
npm run dev           # starts UI on http://localhost:3000
```

Open **http://localhost:3000** — the app is live.

> **Test with these queries:**
> - "How can I install part number PS11752778?"
> - "Is PS3406971 compatible with WDT780SAEM1?"
> - "The ice maker on my Whirlpool fridge is not working"

---

## Setup & Running

### Prerequisites
- **Node.js 18+** (download at [nodejs.org](https://nodejs.org))
- **LLM API key** (one of the options below)

### Step 1: Get an API Key

**Option A — OpenAI (recommended for reliability):**
1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Create a key (starts with `sk-...`)
3. Cost: ~$0.15 per 1M tokens (a full day of testing costs <$1)
4. **Never rate-limited** — ideal for interview demos

**Option B — Gemini (free):**
1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Create a key (no credit card needed)
3. Free tier has daily request limits — may exhaust during heavy testing

### Step 2: Backend

```bash
cd backend
npm install

# Configure your API key
cp .env.example .env
# Edit .env and add: OPENAI_API_KEY=sk-... (or GEMINI_API_KEY=...)

# Start server (auto-seeds product database on first run)
npm run dev
# → http://localhost:4000
```

The server **automatically creates the product database** on first start — no manual seeding needed.

### Step 3: Frontend

```bash
cd frontend
npm install
npm run dev
# → http://localhost:3000
```

### Optional: Scrape more products from PartSelect
```bash
cd backend

# Cheerio scraper (fast, lightweight)
npm run scrape

# Playwright scraper (robust, handles JS rendering + 403 bypass)
npx playwright install chromium
npm run scrape:playwright
```

### Run tests
```bash
cd backend
npm test
# → 41 tests passing (21 router + 9 KB + 11 integration)
```

---

## Deployment

### Option 1 — Local Development (Recommended for demo)

```bash
# ── BACKEND ──────────────────────────────────
cd backend
npm install

# Get a FREE Gemini API key (30 seconds, no credit card):
# https://aistudio.google.com/apikey
# OR use OpenAI: https://platform.openai.com/api-keys

cp .env.example .env
# Edit .env and add your key:
#   GEMINI_API_KEY=your-key      ← free, 1500 req/day
#   OPENAI_API_KEY=sk-...        ← paid, never rate-limited

npm run import-data   # Load 1,600+ real PartSelect products (5 sec)
npm run dev           # Starts on http://localhost:4000

# ── FRONTEND ─────────────────────────────────
cd frontend          # open a second terminal
npm install
npm run dev           # Starts on http://localhost:3000
```

Open **http://localhost:3000** — the chat is live.

### Option 2 — Cloud: Vercel + Render (free tier)

**Step 1: Deploy backend to Render**
1. Push to GitHub: `git push origin main`
2. Go to [render.com](https://render.com) → New Web Service → connect your repo
3. Select the `backend/` folder as root
4. Set **Build Command**: `npm install && npm run import-data`
5. Set **Start Command**: `node src/server.js`
6. Add environment variables:
   - `OPENAI_API_KEY` = your key
   - `PORT` = 4000
7. Deploy — copy the service URL (e.g. `https://partselect-api.onrender.com`)

**Step 2: Deploy frontend to Vercel**
1. Go to [vercel.com](https://vercel.com) → New Project → import your repo
2. Set **Root Directory** to `frontend`
3. Add environment variable:
   - `NEXT_PUBLIC_API_URL` = your Render backend URL
4. Deploy — get your live URL

### Option 3 — Docker

```bash
cd backend
docker build -t partselect-api .
docker run -p 4000:4000 \
  -e OPENAI_API_KEY=sk-... \
  -e NODE_ENV=production \
  partselect-api
```

### Option 4 — PM2 (Production Process Manager)

```bash
# Backend
cd backend
npm install && npm run import-data
npm install -g pm2
pm2 start src/server.js --name partselect-api --env production

# Frontend
cd frontend
npm run build
pm2 start npm --name partselect-ui -- start
pm2 save
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | One of these | Best for demos — paid, never rate-limited |
| `GEMINI_API_KEY` | One of these | Free tier, 1500 req/day |
| `OLLAMA_HOST` | Optional | Local LLM (e.g. http://localhost:11434) |
| `PORT` | Optional | Backend port (default: 4000) |
| `NEXT_PUBLIC_API_URL` | Frontend only | Backend URL in production |

---

## Design Decisions

### Why Gemini over OpenAI?
- **Free tier** — 250 requests/day, no credit card needed
- **Function calling support** — same quality as GPT-4o-mini for tool selection
- **Provider-agnostic** — can switch to OpenAI/Ollama via single env var

### Why both Playwright AND Cheerio?
- **Playwright** — handles JavaScript-rendered content, bypasses 403 blocks with real browser fingerprint, stealth mode for anti-bot detection
- **Cheerio** — 10x faster for pages that don't need JS rendering. Used as the default scraper with Playwright as the robust alternative
- **Best of both worlds** — speed when possible, robustness when needed

### Why Multi-Agent Architecture?
- **Router Agent** pre-classifies intent (saves LLM tokens for simple queries)
- **Orchestrator** uses ReAct loop for complex reasoning chains
- **Separation of concerns** — each layer independently testable and scalable

### Why 4-Tier Data Resolution?
1. **Local DB** — instant response, pre-scraped
2. **Vector store** — semantic matching for fuzzy queries
3. **Live scraping** — real-time data for uncached products
4. **Knowledge base** — always available, even offline

### Why Next.js 14?
- **App Router** with React Server Components
- **TypeScript** for type safety
- **Tailwind CSS** for rapid PartSelect-branded UI
- **Built-in optimizations** — fonts, images, code splitting

---

## Extensibility

The architecture is designed so each layer can be upgraded independently:

| Component | Current | Production Upgrade |
|---|---|---|
| **Database** | `products.json` (1,628 parts) | PostgreSQL / MongoDB |
| **Vector search** | In-process embeddings | Pinecone / Weaviate / ChromaDB |
| **Session cache** | In-memory Map | Redis |
| **LLM** | OpenAI / Gemini / Ollama | Any via `LLMProvider` interface |
| **Observability** | Winston logs | LangSmith / OpenTelemetry / Datadog |
| **Tool protocol** | OpenAI function calling | MCP (Model Context Protocol) |
| **Scraping** | Cheerio + Playwright | Apify / Browserless cloud |
| **Agent framework** | Custom ReAct loop | LangGraph / ADK if needed |

**MCP Integration:** Our 7 tool definitions (`search_part`, `check_compatibility`, etc.) follow the same schema as MCP tool descriptors — converting to MCP servers would require minimal changes. This allows any MCP-compatible client (Claude Desktop, other AI agents) to use our PartSelect tools.

**Specialist agents:** The Router Agent currently routes to the Orchestrator which handles all intents. Splitting into specialist agents (Compatibility Agent, Troubleshooting Agent, Order Agent) is a one-line change — replace the single orchestrator with intent-specific orchestrators each with a focused system prompt and subset of tools.

**Observability:** The Winston logger already outputs structured JSON. Adding LangSmith traces requires only wrapping the `chatCompletion()` call. OpenTelemetry spans can be added at the middleware layer.

**Analytics:** The `/api/feedback` endpoint already collects 👍/👎 per message. Extending to track tool usage, latency, and accuracy requires adding metrics to the existing response format.
