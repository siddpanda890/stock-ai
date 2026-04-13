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
import { analyzeSentiment, sentimentToSignal } from "./news-sentiment";
import { detectRegime, saveRegimeState, getRegimeState } from "./regime-detector";
import { runBacktest, type BacktestConfig } from "./backtest";
import {
  kellyPositionSize,
  fixedRiskPositionSize,
  preTradeRiskCheck,
  recordTradeOpen,
  recordTradeClose,
  getDailyRiskState,
  dynamicConfidenceThreshold,
} from "./risk-manager";
import {
  saveChatHistory,
  getChatHistory,
  appendChatMessage,
  clearChatHistory,
  saveOrders,
  getOrders,
  addOrder,
  updateOrderStatus,
  saveAnalysisResult,
  getAnalysisHistory,
  updateAnalysisAccuracy,
  getSignalAccuracyStats,
} from "./persistence";
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
    features: ["auth", "portfolio", "watchlist", "alerts", "ai-analysis", "chat", "news", "trade-logging", "analytics", "learning-loop", "risk-manager", "news-sentiment", "regime-detection", "backtest", "persistence"],
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
          // Also persist full analysis for forward-tracking
          await saveAnalysisResult(c.env.STOCK_AI_KV, authResult.user.id, {
            symbol,
            model,
            signal: analysis.signal,
            confidence: analysis.confidence,
            targetPrice: analysis.targetPrice,
            stopLoss: analysis.stopLoss,
            summary: analysis.summary,
            technicalAnalysis: analysis.technicalAnalysis,
            riskAssessment: analysis.riskAssessment,
            catalysts: analysis.catalysts,
            timeHorizon: analysis.timeHorizon,
            priceAtAnalysis: quote.price,
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

    // Add news sentiment signal
    let sentimentSignal = null;
    try {
      const sentiment = await analyzeSentiment(symbol);
      const avgVol = historicalData.slice(-20).reduce((s, d) => s + d.volume, 0) / 20;
      sentimentSignal = sentimentToSignal(sentiment, quote, avgVol, indicators.atr);
      signals.push(sentimentSignal);
    } catch { /* non-critical */ }

    // Add regime detection
    let regime = null;
    try {
      regime = detectRegime(historicalData, indicators);
      await saveRegimeState(c.env.STOCK_AI_KV, symbol, regime);
    } catch { /* non-critical */ }

    return c.json({
      success: true,
      data: { symbol, quote, indicators, signals, regime, disclaimer: "Strategy signals for educational purposes only. Not financial advice." },
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ─── News Sentiment (Public) ─────────────────────────
app.get("/api/sentiment/:symbol", async (c) => {
  try {
    const symbol = c.req.param("symbol").toUpperCase();
    const sentiment = await analyzeSentiment(symbol);
    return c.json({ success: true, data: sentiment });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ─── Regime Detection (Public) ───────────────────────
app.get("/api/regime/:symbol", async (c) => {
  try {
    const symbol = c.req.param("symbol").toUpperCase();

    // Check cache first
    const cached = await getRegimeState(c.env.STOCK_AI_KV, symbol);
    if (cached) return c.json({ success: true, data: cached });

    const data = await getHistoricalData(symbol, "6mo", "1d");
    const indicators = calculateIndicators(data);
    const regime = detectRegime(data, indicators);
    await saveRegimeState(c.env.STOCK_AI_KV, symbol, regime);
    return c.json({ success: true, data: regime });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ─── Backtest (Public) ───────────────────────────────
app.post("/api/backtest", async (c) => {
  try {
    const body = await c.req.json<BacktestConfig>();
    if (!body.symbol) return c.json({ success: false, error: "Symbol required" }, 400);

    const historicalData = await getHistoricalData(body.symbol.toUpperCase(), "2y", "1d");

    const config: BacktestConfig = {
      symbol: body.symbol.toUpperCase(),
      strategy: body.strategy || "all",
      initialCapital: body.initialCapital || 100000,
      riskPerTrade: body.riskPerTrade || 0.02,
      maxPositions: body.maxPositions || 3,
      commissionPerTrade: body.commissionPerTrade || 20,
    };

    const result = runBacktest(historicalData, config);
    return c.json({ success: true, data: result });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ─── Risk Check (Public - Kelly sizing calculator) ───
app.post("/api/risk/size", async (c) => {
  try {
    const body = await c.req.json();
    const { entryPrice, stopLoss, portfolioValue, winRate, avgWinLoss, maxRiskPerTrade } = body;
    if (!entryPrice || !stopLoss || !portfolioValue) {
      return c.json({ success: false, error: "entryPrice, stopLoss, portfolioValue required" }, 400);
    }
    const result = kellyPositionSize(
      { maxRiskPerTrade: maxRiskPerTrade || 0.02, maxPositions: 5, dailyLossLimit: 0.05, minConfidence: 60, portfolioValue },
      entryPrice, stopLoss, winRate || 0.5, avgWinLoss || 1.5
    );
    return c.json({ success: true, data: result });
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

    // Proper accounting:
    // portfolioValue = cash + market value of holdings (NOT cost basis)
    // unrealizedPnl = market value - cost basis (for open positions)
    // realizedPnl = running total from all closed trades
    const unrealizedPnl = totalValue - totalInvested;
    const portfolioValue = portfolio.cash + totalValue;
    const winRate = portfolio.totalTradeCount > 0
      ? (portfolio.winCount / portfolio.totalTradeCount) * 100 : 0;

    return c.json({
      success: true,
      data: {
        holdings: enriched,
        trades: portfolio.trades.slice(0, 50),
        cash: portfolio.cash,
        totalInvested,           // cost basis of open positions
        totalValue,              // market value of open positions
        unrealizedPnl,           // totalValue - totalInvested
        unrealizedPnlPercent: totalInvested > 0 ? (unrealizedPnl / totalInvested) * 100 : 0,
        realizedPnl: portfolio.realizedPnl,   // accumulated from closed trades
        portfolioValue,          // cash + market value (true account value)
        totalTradeCount: portfolio.totalTradeCount,
        winCount: portfolio.winCount,
        winRate,
        // Legacy fields for backward compat
        totalPnl: unrealizedPnl + portfolio.realizedPnl,
        totalPnlPercent: (portfolio.cash + totalValue) > 0
          ? ((portfolioValue - 100000) / 100000) * 100 : 0, // vs initial capital
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

// ─── Risk Management ─────────────────────────────────
app.get("/api/user/risk/daily", async (c) => {
  try {
    const userId = c.get("userId");
    const state = await getDailyRiskState(c.env.STOCK_AI_KV, userId);
    return c.json({ success: true, data: state });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.post("/api/user/risk/check", async (c) => {
  try {
    const userId = c.get("userId");
    const { maxPositions, dailyLossLimit, minConfidence, portfolioValue, signalConfidence } = await c.req.json();
    const result = await preTradeRiskCheck(c.env.STOCK_AI_KV, userId, {
      maxRiskPerTrade: 0.02,
      maxPositions: maxPositions || 5,
      dailyLossLimit: dailyLossLimit || 0.05,
      minConfidence: minConfidence || 60,
      portfolioValue: portfolioValue || 100000,
    }, signalConfidence || 0);
    return c.json({ success: true, data: result });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.post("/api/user/risk/dynamic-threshold", async (c) => {
  try {
    const userId = c.get("userId");
    const { baseThreshold } = await c.req.json();
    // Get recent performance to compute dynamic threshold
    const analytics = await generateAnalytics(c.env.STOCK_AI_KV, userId, "30d");
    const overallPerf = analytics.byStrategy.length > 0
      ? analytics.byStrategy.reduce((best, s) => s.totalTrades > best.totalTrades ? s : best, analytics.byStrategy[0])
      : null;
    const winRate = overallPerf ? overallPerf.winRate / 100 : 0.5;
    const sharpe = overallPerf ? overallPerf.sharpeRatio : 0;
    const threshold = dynamicConfidenceThreshold(baseThreshold || 65, winRate, sharpe);
    return c.json({ success: true, data: { baseThreshold: baseThreshold || 65, adjustedThreshold: threshold, winRate, sharpe } });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ─── Chat History Persistence ────────────────────────
app.get("/api/user/chat/history", async (c) => {
  try {
    const userId = c.get("userId");
    const history = await getChatHistory(c.env.STOCK_AI_KV, userId);
    return c.json({ success: true, data: history });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.post("/api/user/chat/history", async (c) => {
  try {
    const userId = c.get("userId");
    const { role, content, symbol, model } = await c.req.json();
    if (!role || !content) return c.json({ success: false, error: "role, content required" }, 400);
    const history = await appendChatMessage(c.env.STOCK_AI_KV, userId, { role, content, symbol, model });
    return c.json({ success: true, data: history });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.delete("/api/user/chat/history", async (c) => {
  try {
    const userId = c.get("userId");
    await clearChatHistory(c.env.STOCK_AI_KV, userId);
    return c.json({ success: true, data: { cleared: true } });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ─── Order Book Persistence ──────────────────────────
app.get("/api/user/orders", async (c) => {
  try {
    const userId = c.get("userId");
    const limit = parseInt(c.req.query("limit") || "100");
    const orders = await getOrders(c.env.STOCK_AI_KV, userId, limit);
    return c.json({ success: true, data: orders });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.post("/api/user/orders", async (c) => {
  try {
    const userId = c.get("userId");
    const body = await c.req.json();
    const { symbol, side, type, quantity, price, triggerPrice, strategy, notes } = body;
    if (!symbol || !side || !quantity || !price) {
      return c.json({ success: false, error: "symbol, side, quantity, price required" }, 400);
    }
    const order = await addOrder(c.env.STOCK_AI_KV, userId, {
      symbol: symbol.toUpperCase(), side, type: type || "MARKET",
      quantity, price, triggerPrice, status: "PENDING",
      strategy: strategy || "manual", notes,
    });
    return c.json({ success: true, data: order });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.put("/api/user/orders/:id", async (c) => {
  try {
    const userId = c.get("userId");
    const orderId = c.req.param("id");
    const { status } = await c.req.json();
    const updated = await updateOrderStatus(c.env.STOCK_AI_KV, userId, orderId, status, status === "FILLED" ? new Date().toISOString() : undefined);
    if (!updated) return c.json({ success: false, error: "Order not found" }, 404);
    return c.json({ success: true, data: updated });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ─── AI Analysis History + Accuracy ──────────────────
app.get("/api/user/analyses", async (c) => {
  try {
    const userId = c.get("userId");
    const limit = parseInt(c.req.query("limit") || "50");
    const analyses = await getAnalysisHistory(c.env.STOCK_AI_KV, userId, limit);
    return c.json({ success: true, data: analyses });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.get("/api/user/analyses/accuracy", async (c) => {
  try {
    const userId = c.get("userId");
    const stats = await getSignalAccuracyStats(c.env.STOCK_AI_KV, userId);
    return c.json({ success: true, data: stats });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.post("/api/user/analyses/update-accuracy", async (c) => {
  try {
    const userId = c.get("userId");
    const { analysisId, currentPrice, daysSinceAnalysis } = await c.req.json();
    if (!analysisId || !currentPrice) {
      return c.json({ success: false, error: "analysisId, currentPrice required" }, 400);
    }
    const updated = await updateAnalysisAccuracy(c.env.STOCK_AI_KV, userId, analysisId, currentPrice, daysSinceAnalysis || 1);
    if (!updated) return c.json({ success: false, error: "Analysis not found" }, 404);
    return c.json({ success: true, data: updated });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

export default app;
