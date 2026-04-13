// Vega Risk Manager — Kelly sizing, daily loss halt, max position limit, dynamic confidence

export interface RiskConfig {
  maxRiskPerTrade: number;     // 0.005 - 0.05 (0.5% - 5%)
  maxPositions: number;        // 1 - 10
  dailyLossLimit: number;      // 0.01 - 0.10 (1% - 10%)
  minConfidence: number;       // 50 - 95
  portfolioValue: number;      // total portfolio $
}

export interface PositionSizeResult {
  shares: number;
  dollarAmount: number;
  riskAmount: number;
  kellyFraction: number;
  riskPercent: number;
  approved: boolean;
  rejectReason?: string;
}

export interface DailyRiskState {
  date: string;          // YYYY-MM-DD
  realizedPnl: number;
  tradesOpened: number;
  tradesClosed: number;
  openPositions: number;
  halted: boolean;
  haltReason?: string;
  peakEquity: number;
  currentDrawdown: number;
}

// ═══════════════════════════════════════════════════════
// KELLY CRITERION POSITION SIZING
// f* = (bp - q) / b
// b = win/loss ratio, p = win probability, q = 1-p
// We use half-Kelly for safety
// ═══════════════════════════════════════════════════════

export function kellyPositionSize(
  config: RiskConfig,
  entryPrice: number,
  stopLoss: number,
  winRate: number,     // 0-1 from strategy performance
  avgWinLoss: number,  // avg win / avg loss ratio
): PositionSizeResult {
  const reject = (reason: string): PositionSizeResult => ({
    shares: 0, dollarAmount: 0, riskAmount: 0,
    kellyFraction: 0, riskPercent: 0, approved: false, rejectReason: reason,
  });

  if (entryPrice <= 0 || stopLoss <= 0) return reject("Invalid price or stop-loss");
  if (config.portfolioValue <= 0) return reject("No portfolio value");

  const slDistance = Math.abs(entryPrice - stopLoss);
  if (slDistance <= 0) return reject("Stop-loss equals entry price");

  // Kelly fraction: f* = (bp - q) / b
  const b = avgWinLoss > 0 ? avgWinLoss : 1.5; // default 1.5:1 if unknown
  const p = winRate > 0 ? Math.min(winRate, 0.95) : 0.5; // cap at 95%, default 50%
  const q = 1 - p;
  const fullKelly = (b * p - q) / b;

  // Half-Kelly for safety (industry standard)
  const halfKelly = Math.max(0, fullKelly * 0.5);

  // Cap at maxRiskPerTrade
  const kellyRisk = Math.min(halfKelly, config.maxRiskPerTrade);

  // Dollar risk = portfolio × risk fraction
  const riskAmount = config.portfolioValue * kellyRisk;

  // Shares = risk amount / distance to stop-loss
  const shares = Math.floor(riskAmount / slDistance);

  if (shares <= 0) return reject("Position too small after Kelly sizing");

  const dollarAmount = shares * entryPrice;
  const riskPercent = (riskAmount / config.portfolioValue) * 100;

  return {
    shares,
    dollarAmount,
    riskAmount,
    kellyFraction: halfKelly,
    riskPercent,
    approved: true,
  };
}

// Simple fixed-risk fallback when no strategy stats available
export function fixedRiskPositionSize(
  config: RiskConfig,
  entryPrice: number,
  stopLoss: number,
): PositionSizeResult {
  return kellyPositionSize(config, entryPrice, stopLoss, 0.5, 1.5);
}

// ═══════════════════════════════════════════════════════
// DAILY LOSS HALT
// ═══════════════════════════════════════════════════════

const RISK_STATE_KEY = (userId: string) => `risk:${userId}:daily`;

export async function getDailyRiskState(
  kv: KVNamespace,
  userId: string,
): Promise<DailyRiskState> {
  const today = new Date().toISOString().slice(0, 10);
  const raw = await kv.get(RISK_STATE_KEY(userId));

  if (raw) {
    const state: DailyRiskState = JSON.parse(raw);
    if (state.date === today) return state;
  }

  // New day — reset
  const fresh: DailyRiskState = {
    date: today,
    realizedPnl: 0,
    tradesOpened: 0,
    tradesClosed: 0,
    openPositions: 0,
    halted: false,
    peakEquity: 0,
    currentDrawdown: 0,
  };
  await kv.put(RISK_STATE_KEY(userId), JSON.stringify(fresh), { expirationTtl: 86400 });
  return fresh;
}

export async function updateDailyRisk(
  kv: KVNamespace,
  userId: string,
  update: Partial<DailyRiskState>,
): Promise<DailyRiskState> {
  const state = await getDailyRiskState(kv, userId);
  const merged = { ...state, ...update };
  await kv.put(RISK_STATE_KEY(userId), JSON.stringify(merged), { expirationTtl: 86400 });
  return merged;
}

export async function recordTradeOpen(
  kv: KVNamespace,
  userId: string,
): Promise<DailyRiskState> {
  const state = await getDailyRiskState(kv, userId);
  state.tradesOpened += 1;
  state.openPositions += 1;
  await kv.put(RISK_STATE_KEY(userId), JSON.stringify(state), { expirationTtl: 86400 });
  return state;
}

export async function recordTradeClose(
  kv: KVNamespace,
  userId: string,
  pnl: number,
  portfolioValue: number,
  dailyLossLimit: number,
): Promise<DailyRiskState> {
  const state = await getDailyRiskState(kv, userId);
  state.tradesClosed += 1;
  state.openPositions = Math.max(0, state.openPositions - 1);
  state.realizedPnl += pnl;

  // Update peak & drawdown
  if (state.realizedPnl > state.peakEquity) {
    state.peakEquity = state.realizedPnl;
  }
  state.currentDrawdown = state.peakEquity - state.realizedPnl;

  // Check daily loss halt
  const lossPercent = Math.abs(Math.min(0, state.realizedPnl)) / portfolioValue;
  if (lossPercent >= dailyLossLimit) {
    state.halted = true;
    state.haltReason = `Daily loss limit hit: ${(lossPercent * 100).toFixed(1)}% (limit: ${(dailyLossLimit * 100).toFixed(0)}%)`;
  }

  await kv.put(RISK_STATE_KEY(userId), JSON.stringify(state), { expirationTtl: 86400 });
  return state;
}

// ═══════════════════════════════════════════════════════
// PRE-TRADE RISK CHECK — gate before any new position
// ═══════════════════════════════════════════════════════

export interface RiskCheckResult {
  approved: boolean;
  rejectReasons: string[];
  dailyState: DailyRiskState;
}

export async function preTradeRiskCheck(
  kv: KVNamespace,
  userId: string,
  config: RiskConfig,
  signalConfidence: number,
): Promise<RiskCheckResult> {
  const state = await getDailyRiskState(kv, userId);
  const reasons: string[] = [];

  // 1. Daily loss halt
  if (state.halted) {
    reasons.push(`HALTED: ${state.haltReason}`);
  }

  // 2. Max position limit
  if (state.openPositions >= config.maxPositions) {
    reasons.push(`Max positions reached: ${state.openPositions}/${config.maxPositions}`);
  }

  // 3. Min confidence filter
  if (signalConfidence < config.minConfidence) {
    reasons.push(`Confidence ${signalConfidence}% below minimum ${config.minConfidence}%`);
  }

  return {
    approved: reasons.length === 0,
    rejectReasons: reasons,
    dailyState: state,
  };
}

// ═══════════════════════════════════════════════════════
// DYNAMIC CONFIDENCE THRESHOLD
// Adjusts minimum confidence based on recent strategy performance
// ═══════════════════════════════════════════════════════

export function dynamicConfidenceThreshold(
  baseThreshold: number,  // user's configured min (e.g., 65)
  recentWinRate: number,  // 0-1, last 20 trades
  recentSharpe: number,   // rolling Sharpe
): number {
  // If performing well (>60% win, Sharpe > 1.0), lower the bar slightly to catch more trades
  // If performing poorly (<40% win, Sharpe < 0.5), raise the bar to be more selective
  let adjustment = 0;

  if (recentWinRate > 0.6 && recentSharpe > 1.0) {
    adjustment = -5; // relax by 5 pts
  } else if (recentWinRate > 0.55 && recentSharpe > 0.75) {
    adjustment = -2;
  } else if (recentWinRate < 0.35 || recentSharpe < 0.3) {
    adjustment = +10; // tighten significantly
  } else if (recentWinRate < 0.45 || recentSharpe < 0.5) {
    adjustment = +5;
  }

  // Clamp between 40 and 95
  return Math.max(40, Math.min(95, baseThreshold + adjustment));
}
