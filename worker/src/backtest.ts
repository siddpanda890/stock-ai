// Vega Backtest Engine — Historical replay with strategy tear sheets
// Replays historical data candle-by-candle through any strategy

import { type HistoricalDataPoint, type TechnicalIndicators, calculateIndicators } from "./stock-data";
import { bollingerSqueeze, atrExpansion, pumpAndDumpDetection, type StrategySignal } from "./strategies";

export interface BacktestConfig {
  symbol: string;
  strategy: "bollinger-squeeze" | "atr-expansion" | "pump-dump" | "all";
  initialCapital: number;
  riskPerTrade: number;      // fraction, e.g., 0.02
  maxPositions: number;
  commissionPerTrade: number; // flat $ per trade
}

export interface BacktestTrade {
  entryIndex: number;
  entryDate: string;
  entryPrice: number;
  exitIndex: number;
  exitDate: string;
  exitPrice: number;
  side: "LONG" | "SHORT";
  shares: number;
  pnl: number;
  pnlPercent: number;
  rMultiple: number;
  holdingBars: number;
  strategy: string;
  signal: string;
}

export interface BacktestResult {
  config: BacktestConfig;
  startDate: string;
  endDate: string;
  totalBars: number;
  trades: BacktestTrade[];
  tearSheet: TearSheet;
  equityCurve: { date: string; equity: number }[];
  drawdownCurve: { date: string; drawdown: number }[];
}

export interface TearSheet {
  totalReturn: number;
  totalReturnPercent: number;
  annualizedReturn: number;
  totalTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  expectancy: number;
  avgRMultiple: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  calmarRatio: number;     // annualized return / max drawdown
  avgHoldingBars: number;
  longestWinStreak: number;
  longestLossStreak: number;
  commissionsPaid: number;
}

// ═══════════════════════════════════════════════════════
// ROLLING INDICATOR CALCULATOR
// Computes indicators for any sub-window of data
// ═══════════════════════════════════════════════════════

function calcIndicatorsForWindow(data: HistoricalDataPoint[]): TechnicalIndicators {
  return calculateIndicators(data);
}

// ═══════════════════════════════════════════════════════
// BACKTEST ENGINE
// ═══════════════════════════════════════════════════════

export function runBacktest(
  data: HistoricalDataPoint[],
  config: BacktestConfig,
): BacktestResult {
  const MIN_WINDOW = 60; // need at least 60 candles for indicators
  if (data.length < MIN_WINDOW) {
    return emptyResult(config, data);
  }

  let capital = config.initialCapital;
  let peakCapital = capital;
  let maxDrawdown = 0;
  let maxDrawdownPercent = 0;
  let commissionsPaid = 0;

  const trades: BacktestTrade[] = [];
  const equityCurve: { date: string; equity: number }[] = [];
  const drawdownCurve: { date: string; drawdown: number }[] = [];

  // Active positions
  interface OpenPosition {
    strategy: string;
    signal: string;
    entryIndex: number;
    entryDate: string;
    entryPrice: number;
    shares: number;
    side: "LONG" | "SHORT";
    stopLoss: number;
    targetPrice: number;
  }

  const openPositions: OpenPosition[] = [];

  // Replay candle by candle
  for (let i = MIN_WINDOW; i < data.length; i++) {
    const window = data.slice(0, i + 1);
    const candle = data[i];
    const indicators = calcIndicatorsForWindow(window);

    // Build a mock quote from the candle
    const mockQuote = {
      symbol: config.symbol,
      name: config.symbol,
      price: candle.close,
      change: i > 0 ? candle.close - data[i - 1].close : 0,
      changePercent: i > 0 ? ((candle.close - data[i - 1].close) / data[i - 1].close) * 100 : 0,
      high: candle.high,
      low: candle.low,
      open: candle.open,
      previousClose: i > 0 ? data[i - 1].close : candle.open,
      volume: candle.volume,
      timestamp: Date.now(),
    };

    // Check exits first
    for (let p = openPositions.length - 1; p >= 0; p--) {
      const pos = openPositions[p];
      let exitPrice = 0;
      let exitReason = "";

      if (pos.side === "LONG") {
        if (candle.low <= pos.stopLoss) {
          exitPrice = pos.stopLoss;
          exitReason = "STOP_LOSS";
        } else if (candle.high >= pos.targetPrice) {
          exitPrice = pos.targetPrice;
          exitReason = "TARGET";
        }
      } else {
        if (candle.high >= pos.stopLoss) {
          exitPrice = pos.stopLoss;
          exitReason = "STOP_LOSS";
        } else if (candle.low <= pos.targetPrice) {
          exitPrice = pos.targetPrice;
          exitReason = "TARGET";
        }
      }

      if (exitPrice > 0) {
        const pnl = pos.side === "LONG"
          ? (exitPrice - pos.entryPrice) * pos.shares
          : (pos.entryPrice - exitPrice) * pos.shares;
        const commission = config.commissionPerTrade;
        const netPnl = pnl - commission;
        commissionsPaid += commission;
        capital += netPnl;

        const riskPerShare = Math.abs(pos.entryPrice - pos.stopLoss);
        const rMultiple = riskPerShare > 0 ? (pnl / (riskPerShare * pos.shares)) : 0;

        trades.push({
          entryIndex: pos.entryIndex,
          entryDate: pos.entryDate,
          entryPrice: pos.entryPrice,
          exitIndex: i,
          exitDate: candle.date,
          exitPrice,
          side: pos.side,
          shares: pos.shares,
          pnl: netPnl,
          pnlPercent: (netPnl / (pos.entryPrice * pos.shares)) * 100,
          rMultiple,
          holdingBars: i - pos.entryIndex,
          strategy: pos.strategy,
          signal: `${pos.signal}→${exitReason}`,
        });

        openPositions.splice(p, 1);
      }
    }

    // Generate signals
    if (openPositions.length < config.maxPositions) {
      const signals: StrategySignal[] = [];

      if (config.strategy === "bollinger-squeeze" || config.strategy === "all") {
        signals.push(bollingerSqueeze(mockQuote, window, indicators));
      }
      if (config.strategy === "atr-expansion" || config.strategy === "all") {
        signals.push(atrExpansion(mockQuote, window, indicators));
      }
      if (config.strategy === "pump-dump" || config.strategy === "all") {
        signals.push(pumpAndDumpDetection(mockQuote, window, indicators));
      }

      for (const sig of signals) {
        if (sig.signal === "HOLD" || sig.targetPrice <= 0 || sig.stopLoss <= 0) continue;
        if (openPositions.length >= config.maxPositions) break;

        // Check we don't already have a position from this strategy
        if (openPositions.some((p) => p.strategy === sig.strategy)) continue;

        const slDistance = Math.abs(candle.close - sig.stopLoss);
        if (slDistance <= 0) continue;

        const riskAmount = capital * config.riskPerTrade;
        const shares = Math.floor(riskAmount / slDistance);
        if (shares <= 0) continue;

        const side: "LONG" | "SHORT" = sig.signal.includes("BUY") ? "LONG" : "SHORT";
        commissionsPaid += config.commissionPerTrade;
        capital -= config.commissionPerTrade;

        openPositions.push({
          strategy: sig.strategy,
          signal: sig.signal,
          entryIndex: i,
          entryDate: candle.date,
          entryPrice: candle.close,
          shares,
          side,
          stopLoss: sig.stopLoss,
          targetPrice: sig.targetPrice,
        });
      }
    }

    // Track equity + drawdown
    const unrealizedPnl = openPositions.reduce((sum, pos) => {
      return sum + (pos.side === "LONG"
        ? (candle.close - pos.entryPrice) * pos.shares
        : (pos.entryPrice - candle.close) * pos.shares);
    }, 0);

    const totalEquity = capital + unrealizedPnl;
    if (totalEquity > peakCapital) peakCapital = totalEquity;
    const dd = peakCapital - totalEquity;
    const ddPercent = peakCapital > 0 ? (dd / peakCapital) * 100 : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;
    if (ddPercent > maxDrawdownPercent) maxDrawdownPercent = ddPercent;

    equityCurve.push({ date: candle.date, equity: Math.round(totalEquity * 100) / 100 });
    drawdownCurve.push({ date: candle.date, drawdown: Math.round(ddPercent * 100) / 100 });
  }

  // Force-close any remaining positions at last price
  const lastCandle = data[data.length - 1];
  for (const pos of openPositions) {
    const pnl = pos.side === "LONG"
      ? (lastCandle.close - pos.entryPrice) * pos.shares
      : (pos.entryPrice - lastCandle.close) * pos.shares;
    capital += pnl;
    trades.push({
      entryIndex: pos.entryIndex,
      entryDate: pos.entryDate,
      entryPrice: pos.entryPrice,
      exitIndex: data.length - 1,
      exitDate: lastCandle.date,
      exitPrice: lastCandle.close,
      side: pos.side,
      shares: pos.shares,
      pnl,
      pnlPercent: (pnl / (pos.entryPrice * pos.shares)) * 100,
      rMultiple: 0,
      holdingBars: data.length - 1 - pos.entryIndex,
      strategy: pos.strategy,
      signal: `${pos.signal}→FORCE_CLOSE`,
    });
  }

  const tearSheet = computeTearSheet(trades, config.initialCapital, capital, data.length, commissionsPaid);

  return {
    config,
    startDate: data[MIN_WINDOW]?.date || data[0]?.date,
    endDate: lastCandle.date,
    totalBars: data.length - MIN_WINDOW,
    trades,
    tearSheet,
    equityCurve,
    drawdownCurve,
  };
}

// ═══════════════════════════════════════════════════════
// TEAR SHEET COMPUTATION
// ═══════════════════════════════════════════════════════

function computeTearSheet(
  trades: BacktestTrade[],
  initialCapital: number,
  finalCapital: number,
  totalBars: number,
  commissionsPaid: number,
): TearSheet {
  const totalReturn = finalCapital - initialCapital;
  const totalReturnPercent = (totalReturn / initialCapital) * 100;

  // Annualized (assume ~252 trading days)
  const years = totalBars / 252;
  const annualizedReturn = years > 0
    ? (Math.pow(finalCapital / initialCapital, 1 / years) - 1) * 100
    : totalReturnPercent;

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;

  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + Math.abs(t.pnl), 0) / losses.length : 0;

  const grossWins = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLosses = losses.reduce((s, t) => s + Math.abs(t.pnl), 0);
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;

  const expectancy = trades.length > 0 ? totalReturn / trades.length : 0;
  const avgRMultiple = trades.length > 0
    ? trades.reduce((s, t) => s + t.rMultiple, 0) / trades.length : 0;

  // Sharpe & Sortino from trade returns
  const returns = trades.map((t) => t.pnlPercent);
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const stdDev = returns.length > 1
    ? Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / returns.length)
    : 0;
  const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252 / Math.max(1, totalBars / trades.length)) : 0;

  const downside = returns.filter((r) => r < 0);
  const downsideDev = downside.length > 0
    ? Math.sqrt(downside.reduce((s, r) => s + r * r, 0) / downside.length)
    : 0;
  const sortinoRatio = downsideDev > 0 ? (avgReturn / downsideDev) * Math.sqrt(252 / Math.max(1, totalBars / trades.length)) : 0;

  // Max drawdown from trades
  let peak = initialCapital;
  let mdd = 0;
  let mddPercent = 0;
  let running = initialCapital;
  for (const t of trades) {
    running += t.pnl;
    if (running > peak) peak = running;
    const dd = peak - running;
    const ddPct = (dd / peak) * 100;
    if (dd > mdd) mdd = dd;
    if (ddPct > mddPercent) mddPercent = ddPct;
  }

  const calmarRatio = mddPercent > 0 ? annualizedReturn / mddPercent : 0;

  // Streaks
  let winStreak = 0, lossStreak = 0, maxWinStreak = 0, maxLossStreak = 0;
  for (const t of trades) {
    if (t.pnl > 0) {
      winStreak++;
      lossStreak = 0;
      if (winStreak > maxWinStreak) maxWinStreak = winStreak;
    } else {
      lossStreak++;
      winStreak = 0;
      if (lossStreak > maxLossStreak) maxLossStreak = lossStreak;
    }
  }

  const avgHoldingBars = trades.length > 0
    ? trades.reduce((s, t) => s + t.holdingBars, 0) / trades.length : 0;

  return {
    totalReturn: Math.round(totalReturn * 100) / 100,
    totalReturnPercent: Math.round(totalReturnPercent * 100) / 100,
    annualizedReturn: Math.round(annualizedReturn * 100) / 100,
    totalTrades: trades.length,
    winRate: Math.round(winRate * 100) / 100,
    avgWin: Math.round(avgWin * 100) / 100,
    avgLoss: Math.round(avgLoss * 100) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100,
    expectancy: Math.round(expectancy * 100) / 100,
    avgRMultiple: Math.round(avgRMultiple * 100) / 100,
    sharpeRatio: Math.round(sharpeRatio * 100) / 100,
    sortinoRatio: Math.round(sortinoRatio * 100) / 100,
    maxDrawdown: Math.round(mdd * 100) / 100,
    maxDrawdownPercent: Math.round(mddPercent * 100) / 100,
    calmarRatio: Math.round(calmarRatio * 100) / 100,
    avgHoldingBars: Math.round(avgHoldingBars * 10) / 10,
    longestWinStreak: maxWinStreak,
    longestLossStreak: maxLossStreak,
    commissionsPaid: Math.round(commissionsPaid * 100) / 100,
  };
}

function emptyResult(config: BacktestConfig, data: HistoricalDataPoint[]): BacktestResult {
  return {
    config,
    startDate: data[0]?.date || "",
    endDate: data[data.length - 1]?.date || "",
    totalBars: 0,
    trades: [],
    tearSheet: {
      totalReturn: 0, totalReturnPercent: 0, annualizedReturn: 0,
      totalTrades: 0, winRate: 0, avgWin: 0, avgLoss: 0,
      profitFactor: 0, expectancy: 0, avgRMultiple: 0,
      sharpeRatio: 0, sortinoRatio: 0, maxDrawdown: 0, maxDrawdownPercent: 0,
      calmarRatio: 0, avgHoldingBars: 0, longestWinStreak: 0, longestLossStreak: 0,
      commissionsPaid: 0,
    },
    equityCurve: [],
    drawdownCurve: [],
  };
}
