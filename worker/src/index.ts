// Stock AI Worker - Full API with Auth, Portfolio, Alerts, News
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  getQuote,
  getHistoricalData,
  calculateIndicators,
  searchSymbol,
  getMarketMovers,
  getStockNews,
} from "./stock-data";
import { analyzeStock, chat, type ChatMessage } from "./ai-analyst";
import { type ModelKey, MODELS } from "./vertex-ai";
import {
  registerUser,
  loginUser,
  getUserFromToken,
  updateUserSettings,
  type UserPublic,
  type User,
} from "./auth";
import {
  getPortfolio,
  executeBuy,
  executeSell,
  getAlerts,
  createAlert,
  deleteAlert,
  checkAlerts,
  getWatchlistSymbols,
  addToWatchlist,
  removeFromWatchlist,
} from "./portfolio";
import { runAllStrategies } from "./strategies";
import {
  logSignal,
  getSignals,
  logTrade,
  closeTrade,
  getTrades,
  generateAnalytics,
  addInsight,
  getInsights,
  analyzeRecentMistakes,
  type SignalLog,
  type TradeLog,
} from "./trade-logger";

type Bindings = {
  VERTEX_PROJECT_ID: string;
  VERTEX_LOCATION: string;
  VERTEX_SERVICE_ACCOUNT_JSON: string;
  ANTHROPIC_API_KEY: string;
  GOOGLE_API_KEY: string;
  CORS_ORIGIN: string;
  JWT_SECRET: string;
  STOCK_AI_KV: KVNamespace;
};

type AuthEnv = { user: User; userId: string };

const app = new Hono<{ Bindings: Bindings; Variables: AuthEnv }>();

// CORS — support multiple origins from env
app.use("*", cors({
  origin: (origin, c) => {
    const allowed = (c.env?.CORS_ORIGIN || "*").split(",").map((s: string) => s.trim());
    if (allowed.includes("*")) return "*";
    return allowed.includes(origin) ? origin : allowed[0];
  },
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}));

// Health check
app.get("/", (c) =>
  c.json({
    name: "Stock AI API",
    version: "2.0.0",
    status: "online",
    models: Object.keys(MODELS),
    features: ["auth", "portfolio", "watchlist", "alerts", "ai-analysis", "chat", "news", "trade-logging", "analytics", "learning-loop"],
  })
);

// ═══════════════════════════════════════════════════════
// AUTH ENDPOINTS (public)
// ═══════════════════════════════════════════════════════

app.post("/api/auth/register", async (c) => {
  try {
    const { username, email, password } = await c.req.json();
    const result = await registerUser(c.env.STOCK_AI_KV, username, email, password);
    if ("error" in result) return c.json({ success: false, error: result.error }, 400);
    return c.json({ success: true, data: result });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.post("/api/auth/login", async (c) => {
  try {
    const { username, password } = await c.req.json();
    const result = await loginUser(c.env.STOCK_AI_KV, username, password);
    if ("error" in result) return c.json({ success: false, error: result.error }, 401);
    return c.json({ success: true, data: result });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.get("/api/auth/me", async (c) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!token) return c.json({ success: false, error: "Not authenticated" }, 401);
  const result = await getUserFromToken(c.env.STOCK_AI_KV, token, c.env.JWT_SECRET);
  if (!result) return c.json({ success: false, error: "Invalid token" }, 401);
  const { user } = result;
  return c.json({
    success: true,
    data: { id: user.id, username: user.username, email: user.email, createdAt: user.createdAt, lastLogin: user.lastLogin, settings: user.settings },
  });
});

// ═══════════════════════════════════════════════════════
// AUTH MIDDLEWARE (protects everything below)
// ═══════════════════════════════════════════════════════

app.use("/api/user/*", async (c, next) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!token) return c.json({ success: false, error: "Authentication required" }, 401);

  const result = await getUserFromToken(c.env.STOCK_AI_KV, token, c.env.JWT_SECRET);
  if (!result) return c.json({ success: false, error: "Invalid or expired token" }, 401);

  c.set("user", result.user);
  c.set("userId", result.user.id);
  await next();
});

// ═══════════════════════════════════════════════════════
// PUBLIC STOCK DATA ENDPOINTS
// ═══════════════════════════════════════════════════════

app.get("/api/quote/:symbol", async (c) => {
  try {
    const symbol = c.req.param("symbol").toUpperCase();
    const quote = await getQuote(symbol);
    return c.json({ success: true, data: quote });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.get("/api/history/:symbol", async (c) => {
  try {
    const symbol = c.req.param("symbol").toUpperCase();
    const range = c.req.query("range") || "6mo";
    const interval = c.req.query("interval") || "1d";
    const data = await getHistoricalData(symbol, range, interval);
    const indicators = calculateIndicators(data);
    return c.json({ success: true, data: { history: data, indicators } });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

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

app.get("/api/market", async (c) => {
  try {
    const movers = await getMarketMovers();
    return c.json({ success: true, data: movers });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.get("/api/news/:symbol", async (c) => {
  try {
    const symbol = c.req.param("symbol").toUpperCase();
    const news = await getStockNews(symbol);
    return c.json({ success: true, data: news });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.post("/api/watchlist", async (c) => {
  try {
    const body = await c.req.json<{ symbols: string[] }>();
    const symbols = body.symbols?.map(s => s.toUpperCase()) || [];
    if (!symbols.length) return c.json({ success: false, error: "Symbols required" }, 400);
    const quotes = await Promise.allSettled(symbols.map(s => getQuote(s)));
    const data = quotes.filter((q): q is PromiseFulfilledResult<any> => q.status === "fulfilled").map(q => q.value);
    return c.json({ success: true, data });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ═══════════════════════════════════════════════════════
// PUBLIC AI ENDPOINTS
// ═══════════════════════════════════════════════════════

app.post("/api/analyze", async (c) => {
  try {
    const body = await c.req.json<{ symbol: string; model?: ModelKey }>();
    const symbol = body.symbol?.toUpperCase();
    if (!symbol) return c.json({ success: false, error: "Symbol required" }, 400);
    const model = body.model || "sonnet-4.6";

    const [quote, historicalData] = await Promise.all([
      getQuote(symbol),
      getHistoricalData(symbol, "6mo", "1d"),
    ]);
    const indicators = calculateIndicators(historicalData);
    const analysis = await analyzeStock(
      { VERTEX_PROJECT_ID: c.env.VERTEX_PROJECT_ID, VERTEX_LOCATION: c.env.VERTEX_LOCATION, VERTEX_SERVICE_ACCOUNT_JSON: c.env.VERTEX_SERVICE_ACCOUNT_JSON, ANTHROPIC_API_KEY: c.env.ANTHROPIC_API_KEY },
      quote, historicalData, indicators, model
    );

    // Auto-log signal to learning loop (if user is authenticated)
    const token = c.req.header("Authorization")?.replace("Bearer ", "");
    if (token) {
      try {
        const authResult = await getUserFromToken(c.env.STOCK_AI_KV, token, c.env.JWT_SECRET);
        if (authResult) {
          await logSignal(c.env.STOCK_AI_KV, authResult.user.id, {
            symbol,
            strategy: "ai-analyst",
            signal: analysis.signal,
            confidence: analysis.confidence,
            targetPrice: analysis.targetPrice,
            stopLoss: analysis.stopLoss,
            indicators: {
              rsi: indicators.rsi,
              macd: indicators.macd,
              sma50: indicators.sma50,
              sma200: indicators.sma200,
              bollingerUpper: indicators.bollingerUpper,
              bollingerLower: indicators.bollingerLower,
            },
            reasoning: analysis.summary,
            model,
          });
        }
      } catch { /* non-critical, don't fail the analysis */ }
    }

    return c.json({
      success: true,
      data: { quote, indicators, analysis, disclaimer: "AI-generated analysis for educational purposes only. Not financial advice." },
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.post("/api/chat", async (c) => {
  try {
    const body = await c.req.json<{ messages: ChatMessage[]; symbol?: string; model?: ModelKey }>();
    if (!body.messages?.length) return c.json({ success: false, error: "Messages required" }, 400);
    const model = body.model || "sonnet-4.6";
    let stockContext = "";

    if (body.symbol) {
      try {
        const [quote, hist] = await Promise.all([getQuote(body.symbol.toUpperCase()), getHistoricalData(body.symbol.toUpperCase(), "3mo", "1d")]);
        const indicators = calculateIndicators(hist);
        stockContext = `\nWatching: ${quote.symbol} at $${quote.price.toFixed(2)} (${quote.changePercent >= 0 ? "+" : ""}${quote.changePercent.toFixed(2)}%)\nRSI: ${indicators.rsi.toFixed(1)} | MACD: ${indicators.macd.toFixed(4)} | SMA50: $${indicators.sma50.toFixed(2)} | SMA200: $${indicators.sma200.toFixed(2)}`;
      } catch { /* non-critical */ }
    }

    const response = await chat(
      { VERTEX_PROJECT_ID: c.env.VERTEX_PROJECT_ID, VERTEX_LOCATION: c.env.VERTEX_LOCATION, VERTEX_SERVICE_ACCOUNT_JSON: c.env.VERTEX_SERVICE_ACCOUNT_JSON, ANTHROPIC_API_KEY: c.env.ANTHROPIC_API_KEY },
      body.messages, stockContext, model
    );
    return c.json({ success: true, data: { response, model } });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ═══════════════════════════════════════════════════════
// STRATEGY SCANNER (Public)
// ═══════════════════════════════════════════════════════

app.post("/api/scan", async (c) => {
  try {
    const body = await c.req.json<{ symbol: string }>();
    const symbol = body.symbol?.toUpperCase();
    if (!symbol) return c.json({ success: false, error: "Symbol required" }, 400);

    const [quote, historicalData] = await Promise.all([
      getQuote(symbol),
      getHistoricalData(symbol, "6mo", "1d"),
    ]);
    const indicators = calculateIndicators(historicalData);
    const signals = runAllStrategies(quote, historicalData, indicators);

    // Auto-log non-HOLD signals for authenticated users
    const token = c.req.header("Authorization")?.replace("Bearer ", "");
    if (token) {
      try {
        const authResult = await getUserFromToken(c.env.STOCK_AI_KV, token, c.env.JWT_SECRET);
        if (authResult) {
          for (const sig of signals.filter((s) => s.signal !== "HOLD")) {
            await logSignal(c.env.STOCK_AI_KV, authResult.user.id, {
              symbol,
              strategy: sig.strategy,
              signal: sig.signal,
              confidence: sig.confidence,
              targetPrice: sig.targetPrice,
              stopLoss: sig.stopLoss,
              indicators: sig.indicators,
              reasoning: sig.reasoning,
            });
          }
        }
      } catch { /* non-critical */ }
    }

    return c.json({
      success: true,
      data: { symbol, quote, indicators, signals, disclaimer: "Strategy signals for educational purposes only. Not financial advice." },
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ═══════════════════════════════════════════════════════
// PROTECTED USER ENDPOINTS
// ═══════════════════════════════════════════════════════

// ─── Settings ─────────────────────────────────────────
app.put("/api/user/settings", async (c) => {
  try {
    const userId = c.get("userId");
    const settings = await c.req.json();
    const updated = await updateUserSettings(c.env.STOCK_AI_KV, userId, settings);
    return c.json({ success: true, data: updated });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ─── Portfolio ────────────────────────────────────────
app.get("/api/user/portfolio", async (c) => {
  try {
    const userId = c.get("userId");
    const portfolio = await getPortfolio(c.env.STOCK_AI_KV, userId);

    // Enrich with current prices
    const symbols = portfolio.holdings.map(h => h.symbol);
    const prices: Record<string, number> = {};
    if (symbols.length > 0) {
      const quotes = await Promise.allSettled(symbols.map(s => getQuote(s)));
      quotes.forEach((q, i) => {
        if (q.status === "fulfilled") prices[symbols[i]] = q.value.price;
      });
    }

    let totalInvested = 0, totalValue = 0;
    const enriched = portfolio.holdings.map(h => {
      const currentPrice = prices[h.symbol] || 0;
      const currentValue = currentPrice * h.quantity;
      const pnl = currentValue - h.totalInvested;
      totalInvested += h.totalInvested;
      totalValue += currentValue;
      return { ...h, currentPrice, currentValue, pnl, pnlPercent: h.totalInvested > 0 ? (pnl / h.totalInvested) * 100 : 0 };
    });

    // Check alerts while we have prices
    const triggered = await checkAlerts(c.env.STOCK_AI_KV, userId, prices);

    return c.json({
      success: true,
      data: {
        holdings: enriched,
        trades: portfolio.trades.slice(0, 50),
        cash: portfolio.cash,
        totalInvested,
        totalValue,
        totalPnl: totalValue - totalInvested,
        totalPnlPercent: totalInvested > 0 ? ((totalValue - totalInvested) / totalInvested) * 100 : 0,
        triggeredAlerts: triggered,
      },
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.post("/api/user/portfolio/buy", async (c) => {
  try {
    const userId = c.get("userId");
    const { symbol, quantity, price, notes } = await c.req.json();
    if (!symbol || !quantity || !price) return c.json({ success: false, error: "symbol, quantity, price required" }, 400);
    const result = await executeBuy(c.env.STOCK_AI_KV, userId, symbol, quantity, price, notes);
    if (!result.success) return c.json(result, 400);

    // Auto-log to learning loop
    try {
      await logTrade(c.env.STOCK_AI_KV, userId, {
        userId,
        symbol: symbol.toUpperCase(),
        side: "BUY",
        quantity,
        price,
        strategy: "manual",
        notes,
      });
    } catch { /* non-critical */ }

    return c.json({ success: true, data: result });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.post("/api/user/portfolio/sell", async (c) => {
  try {
    const userId = c.get("userId");
    const { symbol, quantity, price, notes } = await c.req.json();
    if (!symbol || !quantity || !price) return c.json({ success: false, error: "symbol, quantity, price required" }, 400);
    const result = await executeSell(c.env.STOCK_AI_KV, userId, symbol, quantity, price, notes);
    if (!result.success) return c.json(result, 400);

    // Auto-log to learning loop
    try {
      await logTrade(c.env.STOCK_AI_KV, userId, {
        userId,
        symbol: symbol.toUpperCase(),
        side: "SELL",
        quantity,
        price,
        strategy: "manual",
        notes,
      });
    } catch { /* non-critical */ }

    return c.json({ success: true, data: result });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ─── Watchlist ────────────────────────────────────────
app.get("/api/user/watchlist", async (c) => {
  try {
    const userId = c.get("userId");
    const symbols = await getWatchlistSymbols(c.env.STOCK_AI_KV, userId);
    const quotes = await Promise.allSettled(symbols.map(s => getQuote(s)));
    const data = quotes.filter((q): q is PromiseFulfilledResult<any> => q.status === "fulfilled").map(q => q.value);
    return c.json({ success: true, data });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.post("/api/user/watchlist/add", async (c) => {
  try {
    const userId = c.get("userId");
    const { symbol } = await c.req.json();
    const symbols = await addToWatchlist(c.env.STOCK_AI_KV, userId, symbol);
    return c.json({ success: true, data: symbols });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.post("/api/user/watchlist/remove", async (c) => {
  try {
    const userId = c.get("userId");
    const { symbol } = await c.req.json();
    const symbols = await removeFromWatchlist(c.env.STOCK_AI_KV, userId, symbol);
    return c.json({ success: true, data: symbols });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ─── Alerts ───────────────────────────────────────────
app.get("/api/user/alerts", async (c) => {
  try {
    const userId = c.get("userId");
    const alerts = await getAlerts(c.env.STOCK_AI_KV, userId);
    return c.json({ success: true, data: alerts });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.post("/api/user/alerts", async (c) => {
  try {
    const userId = c.get("userId");
    const { symbol, type, value, message } = await c.req.json();
    if (!symbol || !type || value === undefined) return c.json({ success: false, error: "symbol, type, value required" }, 400);
    const alert = await createAlert(c.env.STOCK_AI_KV, userId, symbol, type, value, message);
    return c.json({ success: true, data: alert });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.delete("/api/user/alerts/:id", async (c) => {
  try {
    const userId = c.get("userId");
    const alertId = c.req.param("id");
    const deleted = await deleteAlert(c.env.STOCK_AI_KV, userId, alertId);
    return c.json({ success: true, data: { deleted } });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ═══════════════════════════════════════════════════════
// LEARNING LOOP ENDPOINTS (Protected)
// ═══════════════════════════════════════════════════════

// ─── Signal Logging ──────────────────────────────────
app.post("/api/user/signals", async (c) => {
  try {
    const userId = c.get("userId");
    const body = await c.req.json();
    const { symbol, strategy, signal, confidence, targetPrice, stopLoss, indicators, reasoning, model } = body;
    if (!symbol || !strategy || !signal) {
      return c.json({ success: false, error: "symbol, strategy, signal required" }, 400);
    }
    const entry = await logSignal(c.env.STOCK_AI_KV, userId, {
      symbol: symbol.toUpperCase(),
      strategy,
      signal,
      confidence: confidence || 0,
      targetPrice: targetPrice || 0,
      stopLoss: stopLoss || 0,
      indicators: indicators || {},
      reasoning: reasoning || "",
      model,
    });
    return c.json({ success: true, data: entry });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.get("/api/user/signals", async (c) => {
  try {
    const userId = c.get("userId");
    const limit = parseInt(c.req.query("limit") || "100");
    const signals = await getSignals(c.env.STOCK_AI_KV, userId, limit);
    return c.json({ success: true, data: signals });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ─── Trade Logging ───────────────────────────────────
app.post("/api/user/trades/log", async (c) => {
  try {
    const userId = c.get("userId");
    const body = await c.req.json();
    const { symbol, side, quantity, price, signalId, strategy, notes } = body;
    if (!symbol || !side || !quantity || !price) {
      return c.json({ success: false, error: "symbol, side, quantity, price required" }, 400);
    }
    const entry = await logTrade(c.env.STOCK_AI_KV, userId, {
      userId,
      symbol: symbol.toUpperCase(),
      side,
      quantity,
      price,
      signalId,
      strategy: strategy || "manual",
      notes,
    });
    return c.json({ success: true, data: entry });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.post("/api/user/trades/close", async (c) => {
  try {
    const userId = c.get("userId");
    const { tradeId, exitPrice, notes } = await c.req.json();
    if (!tradeId || !exitPrice) {
      return c.json({ success: false, error: "tradeId, exitPrice required" }, 400);
    }
    const closed = await closeTrade(c.env.STOCK_AI_KV, userId, tradeId, exitPrice, notes);
    if (!closed) return c.json({ success: false, error: "Trade not found" }, 404);
    return c.json({ success: true, data: closed });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.get("/api/user/trades", async (c) => {
  try {
    const userId = c.get("userId");
    const limit = parseInt(c.req.query("limit") || "100");
    const trades = await getTrades(c.env.STOCK_AI_KV, userId, limit);
    return c.json({ success: true, data: trades });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ─── Analytics ───────────────────────────────────────
app.get("/api/user/analytics", async (c) => {
  try {
    const userId = c.get("userId");
    const period = (c.req.query("period") || "all") as "today" | "7d" | "30d" | "all";
    const analytics = await generateAnalytics(c.env.STOCK_AI_KV, userId, period);
    return c.json({ success: true, data: analytics });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ─── Learning Insights ──────────────────────────────
app.get("/api/user/insights", async (c) => {
  try {
    const userId = c.get("userId");
    const insights = await getInsights(c.env.STOCK_AI_KV, userId);
    return c.json({ success: true, data: insights });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.post("/api/user/insights/analyze", async (c) => {
  try {
    const userId = c.get("userId");
    const newInsights = await analyzeRecentMistakes(c.env.STOCK_AI_KV, userId);
    return c.json({ success: true, data: newInsights });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

export default app;
