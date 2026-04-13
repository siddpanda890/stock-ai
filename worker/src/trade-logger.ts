// Vega Learning Loop - Persistent trade logging, signal tracking & analytics engine
// Stores every signal, decision, and trade outcome for continuous improvement

// ═══════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════

export interface SignalLog {
  id: string;
  timestamp: string;
  symbol: string;
  strategy: string; // "ai-analyst" | "bollinger-squeeze" | "news-sentiment" | "pump-dump" | "manual"
  signal: "STRONG_BUY" | "BUY" | "HOLD" | "SELL" | "STRONG_SELL";
  confidence: number;
  targetPrice: number;
  stopLoss: number;
  indicators: Record<string, number>; // snapshot of key indicators at signal time
  reasoning: string;
  model?: string;
}

export interface TradeLog {
  id: string;
  userId: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  timestamp: string;
  signalId?: string; // links back to the signal that triggered this
  strategy: string;
  notes?: string;
  // Filled on close
  exitPrice?: number;
  exitTimestamp?: string;
  pnl?: number;
  pnlPercent?: number;
  holdingDuration?: number; // minutes
  rMultiple?: number; // PnL / risk per share
  outcome?: "WIN" | "LOSS" | "BREAKEVEN";
}

export interface StrategyPerformance {
  strategy: string;
  totalTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  expectancy: number; // avg $ per trade
  avgRMultiple: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  avgHoldingMinutes: number;
  totalPnl: number;
  bestTrade: number;
  worstTrade: number;
}

export interface LearningInsight {
  id: string;
  timestamp: string;
  type: "pattern" | "mistake" | "improvement" | "anomaly";
  title: string;
  description: string;
  affectedStrategies: string[];
  suggestedAction: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
}

export interface AnalyticsSnapshot {
  generatedAt: string;
  period: string; // "today" | "7d" | "30d" | "all"
  totalSignals: number;
  totalTrades: number;
  overallPnl: number;
  overallWinRate: number;
  byStrategy: StrategyPerformance[];
  recentInsights: LearningInsight[];
  signalAccuracy: Record<string, number>; // strategy → % signals that led to profitable trades
}

// ═══════════════════════════════════════════════════════
// KV KEY HELPERS
// ═══════════════════════════════════════════════════════

const KEYS = {
  signals: (userId: string) => `learning:${userId}:signals`,
  trades: (userId: string) => `learning:${userId}:trades`,
  insights: (userId: string) => `learning:${userId}:insights`,
  analytics: (userId: string, period: string) => `learning:${userId}:analytics:${period}`,
};

// ═══════════════════════════════════════════════════════
// SIGNAL LOGGING
// ═══════════════════════════════════════════════════════

export async function logSignal(
  kv: KVNamespace,
  userId: string,
  signal: Omit<SignalLog, "id" | "timestamp">
): Promise<SignalLog> {
  const entry: SignalLog = {
    id: `sig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    ...signal,
  };

  const existing = await getSignals(kv, userId);
  existing.unshift(entry);

  // Keep last 1000 signals
  const trimmed = existing.slice(0, 1000);
  await kv.put(KEYS.signals(userId), JSON.stringify(trimmed));

  return entry;
}

export async function getSignals(
  kv: KVNamespace,
  userId: string,
  limit: number = 100
): Promise<SignalLog[]> {
  const raw = await kv.get(KEYS.signals(userId));
  if (!raw) return [];
  const all: SignalLog[] = JSON.parse(raw);
  return all.slice(0, limit);
}

// ═══════════════════════════════════════════════════════
// TRADE LOGGING
// ═══════════════════════════════════════════════════════

export async function logTrade(
  kv: KVNamespace,
  userId: string,
  trade: Omit<TradeLog, "id" | "timestamp">
): Promise<TradeLog> {
  const entry: TradeLog = {
    id: `trd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    ...trade,
  };

  const existing = await getTrades(kv, userId);
  existing.unshift(entry);

  const trimmed = existing.slice(0, 2000);
  await kv.put(KEYS.trades(userId), JSON.stringify(trimmed));

  return entry;
}

export async function closeTrade(
  kv: KVNamespace,
  userId: string,
  tradeId: string,
  exitPrice: number,
  notes?: string
): Promise<TradeLog | null> {
  const trades = await getTrades(kv, userId, 2000);
  const idx = trades.findIndex((t) => t.id === tradeId);
  if (idx === -1) return null;

  const trade = trades[idx];
  const entryTime = new Date(trade.timestamp).getTime();
  const exitTime = Date.now();
  const holdingDuration = Math.round((exitTime - entryTime) / 60000);

  const pnl =
    trade.side === "BUY"
      ? (exitPrice - trade.price) * trade.quantity
      : (trade.price - exitPrice) * trade.quantity;

  const pnlPercent =
    trade.side === "BUY"
      ? ((exitPrice - trade.price) / trade.price) * 100
      : ((trade.price - exitPrice) / trade.price) * 100;

  // R-multiple: how many "R" (risk units) did we make/lose
  // Default risk = 2% of entry price if no stop-loss was set
  const riskPerShare = trade.price * 0.02;
  const rMultiple = riskPerShare > 0 ? pnl / (riskPerShare * trade.quantity) : 0;

  trades[idx] = {
    ...trade,
    exitPrice,
    exitTimestamp: new Date(exitTime).toISOString(),
    pnl,
    pnlPercent,
    holdingDuration,
    rMultiple,
    outcome: pnl > 0 ? "WIN" : pnl < 0 ? "LOSS" : "BREAKEVEN",
    notes: notes || trade.notes,
  };

  await kv.put(KEYS.trades(userId), JSON.stringify(trades));
  return trades[idx];
}

export async function getTrades(
  kv: KVNamespace,
  userId: string,
  limit: number = 100
): Promise<TradeLog[]> {
  const raw = await kv.get(KEYS.trades(userId));
  if (!raw) return [];
  const all: TradeLog[] = JSON.parse(raw);
  return all.slice(0, limit);
}

// ═══════════════════════════════════════════════════════
// ANALYTICS ENGINE
// ═══════════════════════════════════════════════════════

function calcStrategyPerformance(
  trades: TradeLog[],
  strategy: string
): StrategyPerformance {
  const stratTrades = trades.filter(
    (t) => t.strategy === strategy && t.outcome !== undefined
  );

  if (stratTrades.length === 0) {
    return {
      strategy,
      totalTrades: 0, wins: 0, losses: 0, breakeven: 0,
      winRate: 0, avgWin: 0, avgLoss: 0, profitFactor: 0,
      expectancy: 0, avgRMultiple: 0, sharpeRatio: 0, sortinoRatio: 0,
      maxDrawdown: 0, avgHoldingMinutes: 0, totalPnl: 0,
      bestTrade: 0, worstTrade: 0,
    };
  }

  const wins = stratTrades.filter((t) => t.outcome === "WIN");
  const losses = stratTrades.filter((t) => t.outcome === "LOSS");
  const breakeven = stratTrades.filter((t) => t.outcome === "BREAKEVEN");

  const pnls = stratTrades.map((t) => t.pnl || 0);
  const totalPnl = pnls.reduce((a, b) => a + b, 0);
  const avgPnl = totalPnl / stratTrades.length;

  const winPnls = wins.map((t) => t.pnl || 0);
  const lossPnls = losses.map((t) => Math.abs(t.pnl || 0));

  const avgWin = winPnls.length > 0 ? winPnls.reduce((a, b) => a + b, 0) / winPnls.length : 0;
  const avgLoss = lossPnls.length > 0 ? lossPnls.reduce((a, b) => a + b, 0) / lossPnls.length : 0;
  const grossWins = winPnls.reduce((a, b) => a + b, 0);
  const grossLosses = lossPnls.reduce((a, b) => a + b, 0);

  // Sharpe Ratio (annualized, assuming daily returns)
  const stdDev = Math.sqrt(
    pnls.reduce((sum, p) => sum + Math.pow(p - avgPnl, 2), 0) / pnls.length
  );
  const sharpeRatio = stdDev > 0 ? (avgPnl / stdDev) * Math.sqrt(252) : 0;

  // Sortino Ratio (only penalize downside deviation)
  const downsidePnls = pnls.filter((p) => p < 0);
  const downsideDev =
    downsidePnls.length > 0
      ? Math.sqrt(
          downsidePnls.reduce((sum, p) => sum + p * p, 0) / downsidePnls.length
        )
      : 0;
  const sortinoRatio = downsideDev > 0 ? (avgPnl / downsideDev) * Math.sqrt(252) : 0;

  // Max drawdown
  let peak = 0;
  let maxDD = 0;
  let cumPnl = 0;
  for (const p of pnls) {
    cumPnl += p;
    if (cumPnl > peak) peak = cumPnl;
    const dd = peak - cumPnl;
    if (dd > maxDD) maxDD = dd;
  }

  // R-multiple average
  const rMultiples = stratTrades.map((t) => t.rMultiple || 0);
  const avgR = rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length;

  // Average holding duration
  const durations = stratTrades.map((t) => t.holdingDuration || 0);
  const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;

  return {
    strategy,
    totalTrades: stratTrades.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: breakeven.length,
    winRate: (wins.length / stratTrades.length) * 100,
    avgWin,
    avgLoss,
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0,
    expectancy: avgPnl,
    avgRMultiple: avgR,
    sharpeRatio,
    sortinoRatio,
    maxDrawdown: maxDD,
    avgHoldingMinutes: avgDuration,
    totalPnl,
    bestTrade: Math.max(...pnls),
    worstTrade: Math.min(...pnls),
  };
}

export async function generateAnalytics(
  kv: KVNamespace,
  userId: string,
  period: "today" | "7d" | "30d" | "all" = "all"
): Promise<AnalyticsSnapshot> {
  const allTrades = await getTrades(kv, userId, 2000);
  const allSignals = await getSignals(kv, userId, 1000);
  const insights = await getInsights(kv, userId);

  // Filter by period
  const now = Date.now();
  const periodMs: Record<string, number> = {
    today: 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
    all: Infinity,
  };
  const cutoff = now - (periodMs[period] || Infinity);

  const trades = allTrades.filter(
    (t) => new Date(t.timestamp).getTime() >= cutoff
  );
  const signals = allSignals.filter(
    (s) => new Date(s.timestamp).getTime() >= cutoff
  );

  // Get unique strategies
  const strategies = [...new Set(trades.map((t) => t.strategy))];

  // Calculate per-strategy performance
  const byStrategy = strategies.map((s) => calcStrategyPerformance(trades, s));

  // Signal accuracy: % of signals that led to profitable trades
  const signalAccuracy: Record<string, number> = {};
  for (const strat of strategies) {
    const stratSignals = signals.filter((s) => s.strategy === strat);
    const stratTrades = trades.filter(
      (t) => t.strategy === strat && t.signalId && t.outcome
    );
    const profitableTrades = stratTrades.filter((t) => t.outcome === "WIN");
    signalAccuracy[strat] =
      stratTrades.length > 0
        ? (profitableTrades.length / stratTrades.length) * 100
        : 0;
  }

  const closedTrades = trades.filter((t) => t.outcome !== undefined);
  const overallPnl = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const overallWins = closedTrades.filter((t) => t.outcome === "WIN").length;

  const snapshot: AnalyticsSnapshot = {
    generatedAt: new Date().toISOString(),
    period,
    totalSignals: signals.length,
    totalTrades: trades.length,
    overallPnl,
    overallWinRate:
      closedTrades.length > 0
        ? (overallWins / closedTrades.length) * 100
        : 0,
    byStrategy,
    recentInsights: insights.slice(0, 10),
    signalAccuracy,
  };

  // Cache the snapshot for 5 minutes
  await kv.put(KEYS.analytics(userId, period), JSON.stringify(snapshot), {
    expirationTtl: 300,
  });

  return snapshot;
}

// ═══════════════════════════════════════════════════════
// LEARNING INSIGHTS
// ═══════════════════════════════════════════════════════

export async function addInsight(
  kv: KVNamespace,
  userId: string,
  insight: Omit<LearningInsight, "id" | "timestamp">
): Promise<LearningInsight> {
  const entry: LearningInsight = {
    id: `ins_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    ...insight,
  };

  const existing = await getInsights(kv, userId);
  existing.unshift(entry);
  const trimmed = existing.slice(0, 200);
  await kv.put(KEYS.insights(userId), JSON.stringify(trimmed));

  return entry;
}

export async function getInsights(
  kv: KVNamespace,
  userId: string,
  limit: number = 50
): Promise<LearningInsight[]> {
  const raw = await kv.get(KEYS.insights(userId));
  if (!raw) return [];
  const all: LearningInsight[] = JSON.parse(raw);
  return all.slice(0, limit);
}

// ═══════════════════════════════════════════════════════
// AUTO-DETECT MISTAKES & PATTERNS
// ═══════════════════════════════════════════════════════

export async function analyzeRecentMistakes(
  kv: KVNamespace,
  userId: string
): Promise<LearningInsight[]> {
  const trades = await getTrades(kv, userId, 200);
  const closedTrades = trades.filter((t) => t.outcome !== undefined);
  const newInsights: LearningInsight[] = [];

  if (closedTrades.length < 3) return newInsights;

  // Pattern 1: Consecutive losses — stop trading that strategy
  const recentClosed = closedTrades.slice(0, 10);
  const strategies = [...new Set(recentClosed.map((t) => t.strategy))];

  for (const strat of strategies) {
    const stratRecent = recentClosed.filter((t) => t.strategy === strat);
    const consecutiveLosses = stratRecent.findIndex((t) => t.outcome !== "LOSS");
    if (consecutiveLosses >= 3 || (consecutiveLosses === -1 && stratRecent.length >= 3)) {
      const lossCount = consecutiveLosses === -1 ? stratRecent.length : consecutiveLosses;
      newInsights.push({
        id: "", timestamp: "",
        type: "mistake",
        title: `${lossCount} consecutive losses on ${strat}`,
        description: `Strategy "${strat}" has ${lossCount} losses in a row. Consider pausing this strategy or reducing position size until conditions improve.`,
        affectedStrategies: [strat],
        suggestedAction: "Reduce position size by 50% or pause strategy",
        priority: lossCount >= 5 ? "HIGH" : "MEDIUM",
      });
    }
  }

  // Pattern 2: Holding losers too long
  const longLosses = closedTrades.filter(
    (t) => t.outcome === "LOSS" && (t.holdingDuration || 0) > 480
  );
  if (longLosses.length >= 2) {
    newInsights.push({
      id: "", timestamp: "",
      type: "mistake",
      title: "Holding losing positions too long",
      description: `${longLosses.length} losing trades held over 8 hours. Average loss: $${(longLosses.reduce((s, t) => s + Math.abs(t.pnl || 0), 0) / longLosses.length).toFixed(2)}. Tighter stop-losses would reduce drawdown.`,
      affectedStrategies: [...new Set(longLosses.map((t) => t.strategy))],
      suggestedAction: "Implement ATR-based trailing stops; max hold time 4 hours for day trades",
      priority: "HIGH",
    });
  }

  // Pattern 3: Oversized losses (any single loss > 3% of implied portfolio)
  const bigLosses = closedTrades.filter(
    (t) => t.outcome === "LOSS" && Math.abs(t.pnlPercent || 0) > 5
  );
  if (bigLosses.length >= 1) {
    newInsights.push({
      id: "", timestamp: "",
      type: "mistake",
      title: "Position sizing too aggressive",
      description: `${bigLosses.length} trades with >5% loss. Worst: ${bigLosses[0].symbol} at ${bigLosses[0].pnlPercent?.toFixed(1)}%. Kelly criterion suggests smaller positions.`,
      affectedStrategies: [...new Set(bigLosses.map((t) => t.strategy))],
      suggestedAction: "Cap position risk at 1-2% of portfolio using Kelly criterion sizing",
      priority: "HIGH",
    });
  }

  // Pattern 4: Winning strategy getting ignored
  for (const strat of strategies) {
    const perf = calcStrategyPerformance(closedTrades, strat);
    if (perf.winRate > 65 && perf.totalTrades >= 5 && perf.profitFactor > 1.5) {
      const recentSignals = (await getSignals(kv, userId, 50)).filter(
        (s) => s.strategy === strat
      );
      const recentStratTrades = trades.filter(
        (t) => t.strategy === strat && new Date(t.timestamp).getTime() > Date.now() - 7 * 86400000
      );
      if (recentSignals.length > recentStratTrades.length * 2) {
        newInsights.push({
          id: "", timestamp: "",
          type: "improvement",
          title: `Underutilizing high-performing "${strat}"`,
          description: `${strat} has ${perf.winRate.toFixed(0)}% win rate and ${perf.profitFactor.toFixed(1)}x profit factor, but only ${recentStratTrades.length}/${recentSignals.length} signals were acted on.`,
          affectedStrategies: [strat],
          suggestedAction: "Increase allocation to this strategy; consider auto-execution",
          priority: "MEDIUM",
        });
      }
    }
  }

  // Save new insights
  for (const insight of newInsights) {
    await addInsight(kv, userId, insight);
  }

  return newInsights;
}
