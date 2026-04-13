// Vega Regime Detector — Market regime classification + strategy bias switching
// Uses volatility, trend strength, and breadth to classify regimes

import { type HistoricalDataPoint, type TechnicalIndicators } from "./stock-data";

export type MarketRegime =
  | "TRENDING_BULL"     // strong uptrend, low-medium vol → momentum strategies
  | "TRENDING_BEAR"     // strong downtrend → inverse momentum, hedging
  | "HIGH_VOLATILITY"   // no clear trend, high vol → mean reversion, tighter stops
  | "LOW_VOLATILITY"    // range-bound, low vol → squeeze breakout, wider targets
  | "TRANSITIONAL";     // regime changing → reduce exposure

export interface RegimeAnalysis {
  regime: MarketRegime;
  confidence: number;       // 0-100
  volatilityLevel: "LOW" | "MEDIUM" | "HIGH" | "EXTREME";
  trendStrength: number;    // 0-1 (0 = no trend, 1 = strong trend)
  trendDirection: "UP" | "DOWN" | "SIDEWAYS";
  strategyBias: StrategyBias;
  indicators: RegimeIndicators;
  description: string;
  timestamp: string;
}

export interface StrategyBias {
  momentum: number;        // 0-1 weight for momentum strategies
  meanReversion: number;   // 0-1 weight for mean reversion
  breakout: number;        // 0-1 weight for breakout strategies
  sentiment: number;       // 0-1 weight for news sentiment
  defensive: number;       // 0-1 weight for defensive/hedging
}

export interface RegimeIndicators {
  atr14: number;
  atrRatio: number;        // current ATR / 50-day avg ATR
  adx: number;             // Average Directional Index (trend strength)
  sma50vs200: number;      // SMA50/SMA200 ratio
  rsi14: number;
  bbWidth: number;         // Bollinger Band width as % of middle
  volatilityPercentile: number; // ATR percentile over last 100 days
}

// ═══════════════════════════════════════════════════════
// ADX CALCULATION (Average Directional Index)
// Measures trend strength regardless of direction
// ═══════════════════════════════════════════════════════

function calculateADX(data: HistoricalDataPoint[], period: number = 14): number {
  if (data.length < period + 1) return 25; // default neutral

  const dxValues: number[] = [];

  for (let i = 1; i < data.length; i++) {
    const highDiff = data[i].high - data[i - 1].high;
    const lowDiff = data[i - 1].low - data[i].low;

    const plusDM = highDiff > lowDiff && highDiff > 0 ? highDiff : 0;
    const minusDM = lowDiff > highDiff && lowDiff > 0 ? lowDiff : 0;

    const tr = Math.max(
      data[i].high - data[i].low,
      Math.abs(data[i].high - data[i - 1].close),
      Math.abs(data[i].low - data[i - 1].close)
    );

    if (i >= period) {
      const lookback = data.slice(i - period + 1, i + 1);
      let sumTR = 0, sumPlusDM = 0, sumMinusDM = 0;

      for (let j = 1; j < lookback.length; j++) {
        const hd = lookback[j].high - lookback[j - 1].high;
        const ld = lookback[j - 1].low - lookback[j].low;
        sumPlusDM += hd > ld && hd > 0 ? hd : 0;
        sumMinusDM += ld > hd && ld > 0 ? ld : 0;
        sumTR += Math.max(
          lookback[j].high - lookback[j].low,
          Math.abs(lookback[j].high - lookback[j - 1].close),
          Math.abs(lookback[j].low - lookback[j - 1].close)
        );
      }

      if (sumTR > 0) {
        const plusDI = (sumPlusDM / sumTR) * 100;
        const minusDI = (sumMinusDM / sumTR) * 100;
        const diSum = plusDI + minusDI;
        if (diSum > 0) {
          dxValues.push(Math.abs(plusDI - minusDI) / diSum * 100);
        }
      }
    }
  }

  if (dxValues.length < period) return dxValues.length > 0
    ? dxValues.reduce((a, b) => a + b, 0) / dxValues.length
    : 25;

  // Smoothed ADX = SMA of DX
  const recentDX = dxValues.slice(-period);
  return recentDX.reduce((a, b) => a + b, 0) / recentDX.length;
}

// ═══════════════════════════════════════════════════════
// VOLATILITY PERCENTILE
// Where current ATR sits vs. last 100 days
// ═══════════════════════════════════════════════════════

function calculateVolatilityPercentile(data: HistoricalDataPoint[], period: number = 14): number {
  if (data.length < period + 10) return 50;

  const atrs: number[] = [];
  for (let i = period; i < data.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += Math.max(
        data[j].high - data[j].low,
        Math.abs(data[j].high - data[j - 1].close),
        Math.abs(data[j].low - data[j - 1].close)
      );
    }
    atrs.push(sum / period);
  }

  const currentATR = atrs[atrs.length - 1];
  const sorted = [...atrs].sort((a, b) => a - b);
  const rank = sorted.findIndex((v) => v >= currentATR);
  return rank >= 0 ? (rank / sorted.length) * 100 : 50;
}

// ═══════════════════════════════════════════════════════
// REGIME DETECTION
// ═══════════════════════════════════════════════════════

export function detectRegime(
  data: HistoricalDataPoint[],
  indicators: TechnicalIndicators,
): RegimeAnalysis {
  const adx = calculateADX(data);
  const volPercentile = calculateVolatilityPercentile(data);

  const atrRatio = indicators.atr / (indicators.sma20 * 0.02); // normalized
  const bbWidth = indicators.bollingerUpper > 0 && indicators.bollingerMiddle > 0
    ? (indicators.bollingerUpper - indicators.bollingerLower) / indicators.bollingerMiddle
    : 0;
  const sma50vs200 = indicators.sma200 > 0 ? indicators.sma50 / indicators.sma200 : 1;

  const regimeIndicators: RegimeIndicators = {
    atr14: indicators.atr,
    atrRatio,
    adx,
    sma50vs200,
    rsi14: indicators.rsi,
    bbWidth,
    volatilityPercentile: volPercentile,
  };

  // Classify trend
  const trendDirection: "UP" | "DOWN" | "SIDEWAYS" =
    sma50vs200 > 1.02 ? "UP" :
    sma50vs200 < 0.98 ? "DOWN" : "SIDEWAYS";

  // ADX: <20 = no trend, 20-40 = moderate, >40 = strong
  const trendStrength = Math.min(1, adx / 50);
  const strongTrend = adx > 25;

  // Volatility classification
  const volatilityLevel: "LOW" | "MEDIUM" | "HIGH" | "EXTREME" =
    volPercentile < 20 ? "LOW" :
    volPercentile < 50 ? "MEDIUM" :
    volPercentile < 80 ? "HIGH" : "EXTREME";

  // Determine regime
  let regime: MarketRegime;
  let confidence: number;
  let description: string;
  let bias: StrategyBias;

  if (strongTrend && trendDirection === "UP" && volatilityLevel !== "EXTREME") {
    regime = "TRENDING_BULL";
    confidence = Math.min(90, 50 + adx);
    description = `Bullish trend (ADX: ${adx.toFixed(0)}, SMA50/200: ${sma50vs200.toFixed(3)}). Favor momentum and breakout strategies.`;
    bias = { momentum: 0.9, meanReversion: 0.1, breakout: 0.7, sentiment: 0.5, defensive: 0.1 };
  } else if (strongTrend && trendDirection === "DOWN") {
    regime = "TRENDING_BEAR";
    confidence = Math.min(90, 50 + adx);
    description = `Bearish trend (ADX: ${adx.toFixed(0)}, SMA50/200: ${sma50vs200.toFixed(3)}). Reduce exposure, favor defensive plays.`;
    bias = { momentum: 0.3, meanReversion: 0.2, breakout: 0.2, sentiment: 0.7, defensive: 0.9 };
  } else if (volatilityLevel === "HIGH" || volatilityLevel === "EXTREME") {
    regime = "HIGH_VOLATILITY";
    confidence = Math.min(85, 40 + volPercentile * 0.5);
    description = `High volatility (${volPercentile.toFixed(0)}th percentile). Mean reversion works, tighten stops, reduce size.`;
    bias = { momentum: 0.3, meanReversion: 0.9, breakout: 0.3, sentiment: 0.6, defensive: 0.7 };
  } else if (volatilityLevel === "LOW" && !strongTrend) {
    regime = "LOW_VOLATILITY";
    confidence = Math.min(80, 40 + (100 - volPercentile) * 0.4);
    description = `Low volatility squeeze (${volPercentile.toFixed(0)}th percentile, ADX: ${adx.toFixed(0)}). Watch for breakout.`;
    bias = { momentum: 0.4, meanReversion: 0.4, breakout: 0.9, sentiment: 0.4, defensive: 0.3 };
  } else {
    regime = "TRANSITIONAL";
    confidence = 50;
    description = `Mixed signals (ADX: ${adx.toFixed(0)}, vol: ${volPercentile.toFixed(0)}th pct). Regime unclear — reduce exposure until direction confirms.`;
    bias = { momentum: 0.4, meanReversion: 0.4, breakout: 0.4, sentiment: 0.5, defensive: 0.5 };
  }

  return {
    regime,
    confidence,
    volatilityLevel,
    trendStrength,
    trendDirection,
    strategyBias: bias,
    indicators: regimeIndicators,
    description,
    timestamp: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════
// PERSIST REGIME STATE TO KV
// ═══════════════════════════════════════════════════════

export async function saveRegimeState(
  kv: KVNamespace,
  symbol: string,
  regime: RegimeAnalysis,
): Promise<void> {
  await kv.put(
    `regime:${symbol}:latest`,
    JSON.stringify(regime),
    { expirationTtl: 3600 } // 1 hour cache
  );

  // Also log to history for regime-change tracking
  const historyKey = `regime:${symbol}:history`;
  const raw = await kv.get(historyKey);
  const history: RegimeAnalysis[] = raw ? JSON.parse(raw) : [];
  history.unshift(regime);
  await kv.put(historyKey, JSON.stringify(history.slice(0, 100)));
}

export async function getRegimeState(
  kv: KVNamespace,
  symbol: string,
): Promise<RegimeAnalysis | null> {
  const raw = await kv.get(`regime:${symbol}:latest`);
  return raw ? JSON.parse(raw) : null;
}
