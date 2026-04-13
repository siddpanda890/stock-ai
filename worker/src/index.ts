// Stock AI Worker - Main API Entry Point
// Cloudflare Workers backend with Hono router

import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  getQuote,
  getHistoricalData,
  calculateIndicators,
  searchSymbol,
  getMarketMovers,
} from "./stock-data";
import { analyzeStock, chat, type ChatMessage } from "./ai-analyst";
import { type ModelKey, MODELS } from "./vertex-ai";

type Bindings = {
  VERTEX_PROJECT_ID: string;
  VERTEX_LOCATION: string;
  VERTEX_SERVICE_ACCOUNT_JSON: string;
  ANTHROPIC_API_KEY: string;
  GOOGLE_API_KEY: string;
  CORS_ORIGIN: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// CORS
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })
);

// Health check
app.get("/", (c) =>
  c.json({
    name: "Stock AI API",
    version: "1.0.0",
    status: "online",
    models: Object.keys(MODELS),
    endpoints: [
      "GET /api/quote/:symbol",
      "GET /api/history/:symbol",
      "GET /api/search?q=",
      "GET /api/market",
      "POST /api/analyze",
      "POST /api/chat",
    ],
  })
);

// ─── Stock Data Endpoints ─────────────────────────────

// Get real-time quote
app.get("/api/quote/:symbol", async (c) => {
  try {
    const symbol = c.req.param("symbol").toUpperCase();
    const quote = await getQuote(symbol);
    return c.json({ success: true, data: quote });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// Get historical data
app.get("/api/history/:symbol", async (c) => {
  try {
    const symbol = c.req.param("symbol").toUpperCase();
    const range = (c.req.query("range") as string) || "6mo";
    const interval = (c.req.query("interval") as string) || "1d";
    const data = await getHistoricalData(symbol, range, interval);
    const indicators = calculateIndicators(data);
    return c.json({ success: true, data: { history: data, indicators } });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// Search symbols
app.get("/api/search", async (c) => {
  try {
    const q = c.req.query("q") || "";
    if (!q) return c.json({ success: false, error: "Query required" }, 400);
    const results = await searchSymbol(q);
    return c.json({ success: true, data: results });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// Market overview
app.get("/api/market", async (c) => {
  try {
    const movers = await getMarketMovers();
    return c.json({ success: true, data: movers });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ─── AI Analysis Endpoints ────────────────────────────

// Full AI analysis with buy/sell signal
app.post("/api/analyze", async (c) => {
  try {
    const body = await c.req.json<{
      symbol: string;
      model?: ModelKey;
    }>();

    const symbol = body.symbol?.toUpperCase();
    if (!symbol)
      return c.json({ success: false, error: "Symbol required" }, 400);

    const model = body.model || "sonnet-4.6";

    // Fetch data in parallel
    const [quote, historicalData] = await Promise.all([
      getQuote(symbol),
      getHistoricalData(symbol, "6mo", "1d"),
    ]);

    const indicators = calculateIndicators(historicalData);

    const analysis = await analyzeStock(
      {
        VERTEX_PROJECT_ID: c.env.VERTEX_PROJECT_ID,
        VERTEX_LOCATION: c.env.VERTEX_LOCATION,
        VERTEX_SERVICE_ACCOUNT_JSON: c.env.VERTEX_SERVICE_ACCOUNT_JSON,
        ANTHROPIC_API_KEY: c.env.ANTHROPIC_API_KEY,
      },
      quote,
      historicalData,
      indicators,
      model
    );

    return c.json({
      success: true,
      data: {
        quote,
        indicators,
        analysis,
        disclaimer:
          "This is AI-generated analysis for educational purposes only. Not financial advice. Always do your own research.",
      },
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// AI Chat
app.post("/api/chat", async (c) => {
  try {
    const body = await c.req.json<{
      messages: ChatMessage[];
      symbol?: string;
      model?: ModelKey;
    }>();

    if (!body.messages?.length)
      return c.json({ success: false, error: "Messages required" }, 400);

    const model = body.model || "sonnet-4.6";
    let stockContext = "";

    // If a symbol is provided, fetch its data for context
    if (body.symbol) {
      try {
        const [quote, hist] = await Promise.all([
          getQuote(body.symbol.toUpperCase()),
          getHistoricalData(body.symbol.toUpperCase(), "3mo", "1d"),
        ]);
        const indicators = calculateIndicators(hist);
        stockContext = `
Watching: ${quote.symbol} at $${quote.price.toFixed(2)} (${quote.changePercent >= 0 ? "+" : ""}${quote.changePercent.toFixed(2)}%)
RSI: ${indicators.rsi.toFixed(1)} | MACD: ${indicators.macd.toFixed(4)} | SMA50: $${indicators.sma50.toFixed(2)} | SMA200: $${indicators.sma200.toFixed(2)}`;
      } catch {
        // Non-critical, continue without context
      }
    }

    const response = await chat(
      {
        VERTEX_PROJECT_ID: c.env.VERTEX_PROJECT_ID,
        VERTEX_LOCATION: c.env.VERTEX_LOCATION,
        VERTEX_SERVICE_ACCOUNT_JSON: c.env.VERTEX_SERVICE_ACCOUNT_JSON,
        ANTHROPIC_API_KEY: c.env.ANTHROPIC_API_KEY,
      },
      body.messages,
      stockContext,
      model
    );

    return c.json({ success: true, data: { response, model } });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// Watchlist multi-quote
app.post("/api/watchlist", async (c) => {
  try {
    const body = await c.req.json<{ symbols: string[] }>();
    const symbols = body.symbols?.map((s) => s.toUpperCase()) || [];

    if (!symbols.length)
      return c.json({ success: false, error: "Symbols required" }, 400);

    const quotes = await Promise.allSettled(symbols.map((s) => getQuote(s)));

    const data = quotes
      .filter((q): q is PromiseFulfilledResult<any> => q.status === "fulfilled")
      .map((q) => q.value);

    return c.json({ success: true, data });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

export default app;
