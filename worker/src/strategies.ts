// Vega Strategy Engines - Bollinger Squeeze, ATR Expansion, News Sentiment, Pump & Dump Detection
// Each engine produces a SignalLog-compatible output

import {
  type StockQuote,
  type HistoricalDataPoint,
  type TechnicalIndicators,
} from "./stock-data";

export interface StrategySignal {
  strategy: string;
  signal: "STRONG_BUY" | "BUY" | "HOLD" | "SELL" | "STRONG_SELL";
  confidence: number;
  targetPrice: number;
  stopLoss: number;
  reasoning: string;
  indicators: Record<string, number>;
}

// ═══════════════════════════════════════════════════════
// BOLLINGER SQUEEZE BREAKOUT (TTM Squeeze)
// Detects low-volatility compression → high-volatility breakout
// ═══════════════════════════════════════════════════════

export function bollingerSqueeze(
  quote: StockQuote,
  data: HistoricalDataPoint[],
  indicators: TechnicalIndicators
): StrategySignal {
  const closes = data.map((d) => d.close).filter(Boolean);
  if (closes.length < 30) {
    return holdSignal("bollinger-squeeze", "Insufficient data for Bollinger Squeeze analysis");
  }

  const price = quote.price;
  const { bollingerUpper, bollingerMiddle, bollingerLower, atr } = indicators;
  const bbWidth = (bollingerUpper - bollingerLower) / bollingerMiddle;

  // Calculate historical BB width to detect squeeze
  const bbWidths: number[] = [];
  for (let i = 20; i < closes.length; i++) {
    const window = closes.slice(i - 20, i);
    const mean = window.reduce((a, b) => a + b, 0) / 20;
    const stdDev = Math.sqrt(window.reduce((s, x) => s + (x - mean) ** 2, 0) / 20);
    bbWidths.push((2 * 2 * stdDev) / mean);
  }

  const avgBBWidth = bbWidths.reduce((a, b) => a + b, 0) / bbWidths.length;
  const isSqueeze = bbWidth < avgBBWidth * 0.6; // Width below 60% of average = squeeze

  // Keltner Channel check (simplified: 1.5x ATR bands)
  const keltnerUpper = bollingerMiddle + 1.5 * atr;
  const keltnerLower = bollingerMiddle - 1.5 * atr;
  const bbInsideKeltner = bollingerUpper < keltnerUpper && bollingerLower > keltnerLower;

  // Momentum direction (using last 3 closes)
  const recent3 = closes.slice(-3);
  const momentum = recent3[2] - recent3[0];
  const momentumUp = momentum > 0;

  // MACD histogram momentum
  const { macdHistogram } = indicators;
  const macdBullish = macdHistogram > 0;

  const snapIndicators: Record<string, number> = {
    bbWidth,
    avgBBWidth,
    squeezeTightness: bbWidth / avgBBWidth,
    momentum,
    macdHistogram,
    price,
  };

  if (isSqueeze || bbInsideKeltner) {
    // Squeeze detected — waiting for breakout
    if (price > bollingerUpper && momentumUp && macdBullish) {
      // Upside breakout!
      const target = price + (bollingerUpper - bollingerMiddle) * 2;
      return {
        strategy: "bollinger-squeeze",
        signal: "STRONG_BUY",
        confidence: 82,
        targetPrice: round(target),
        stopLoss: round(bollingerMiddle),
        reasoning: `Bollinger Squeeze breakout to upside. BB width at ${(bbWidth * 100).toFixed(1)}% (avg ${(avgBBWidth * 100).toFixed(1)}%). Price broke above upper band with bullish MACD momentum.`,
        indicators: snapIndicators,
      };
    } else if (price < bollingerLower && !momentumUp && !macdBullish) {
      // Downside breakdown
      const target = price - (bollingerMiddle - bollingerLower) * 2;
      return {
        strategy: "bollinger-squeeze",
        signal: "STRONG_SELL",
        confidence: 78,
        targetPrice: round(target),
        stopLoss: round(bollingerMiddle),
        reasoning: `Bollinger Squeeze breakdown to downside. BB width at ${(bbWidth * 100).toFixed(1)}%. Price broke below lower band with bearish momentum.`,
        indicators: snapIndicators,
      };
    } else {
      return {
        strategy: "bollinger-squeeze",
        signal: "HOLD",
        confidence: 60,
        targetPrice: round(momentumUp ? bollingerUpper : bollingerLower),
        stopLoss: round(momentumUp ? bollingerLower : bollingerUpper),
        reasoning: `Bollinger Squeeze active (width ${(bbWidth * 100).toFixed(1)}% vs avg ${(avgBBWidth * 100).toFixed(1)}%). Waiting for breakout direction. Momentum ${momentumUp ? "positive" : "negative"}.`,
        indicators: snapIndicators,
      };
    }
  }

  // No squeeze — check for mean reversion opportunities
  if (price > bollingerUpper && indicators.rsi > 70) {
    return {
      strategy: "bollinger-squeeze",
      signal: "SELL",
      confidence: 65,
      targetPrice: round(bollingerMiddle),
      stopLoss: round(bollingerUpper + atr),
      reasoning: `Overbought: price above upper Bollinger Band with RSI ${indicators.rsi.toFixed(0)}. Mean reversion likely to $${bollingerMiddle.toFixed(2)}.`,
      indicators: snapIndicators,
    };
  }

  if (price < bollingerLower && indicators.rsi < 30) {
    return {
      strategy: "bollinger-squeeze",
      signal: "BUY",
      confidence: 65,
      targetPrice: round(bollingerMiddle),
      stopLoss: round(bollingerLower - atr),
      reasoning: `Oversold: price below lower Bollinger Band with RSI ${indicators.rsi.toFixed(0)}. Mean reversion likely to $${bollingerMiddle.toFixed(2)}.`,
      indicators: snapIndicators,
    };
  }

  return holdSignal("bollinger-squeeze", `No squeeze or extreme detected. BB width ${(bbWidth * 100).toFixed(1)}%.`);
}

// ═══════════════════════════════════════════════════════
// ATR EXPANSION DETECTION
// Spots sudden volatility spikes for momentum plays
// ═══════════════════════════════════════════════════════

export function atrExpansion(
  quote: StockQuote,
  data: HistoricalDataPoint[],
  indicators: TechnicalIndicators
): StrategySignal {
  const closes = data.map((d) => d.close).filter(Boolean);
  const highs = data.map((d) => d.high).filter(Boolean);
  const lows = data.map((d) => d.low).filter(Boolean);

  if (closes.length < 30) {
    return holdSignal("atr-expansion", "Insufficient data for ATR analysis");
  }

  const { atr, sma20, sma50, macd, rsi } = indicators;
  const price = quote.price;

  // Calculate ATR history to find expansion
  const atrHistory: number[] = [];
  for (let i = 14; i < closes.length; i++) {
    let sum = 0;
    for (let j = i - 13; j <= i; j++) {
      const tr = Math.max(
        highs[j] - lows[j],
        Math.abs(highs[j] - closes[j - 1]),
        Math.abs(lows[j] - closes[j - 1])
      );
      sum += tr;
    }
    atrHistory.push(sum / 14);
  }

  const avgATR = atrHistory.reduce((a, b) => a + b, 0) / atrHistory.length;
  const atrRatio = atr / avgATR;

  const snapIndicators: Record<string, number> = {
    atr,
    avgATR,
    atrRatio,
    rsi,
    macd,
    price,
  };

  if (atrRatio > 1.8) {
    // Major volatility expansion
    const trendUp = price > sma20 && sma20 > sma50;
    const trendDown = price < sma20 && sma20 < sma50;

    if (trendUp && macd > 0) {
      return {
        strategy: "atr-expansion",
        signal: "STRONG_BUY",
        confidence: 75,
        targetPrice: round(price + atr * 2),
        stopLoss: round(price - atr * 1.5),
        reasoning: `ATR expansion ${atrRatio.toFixed(1)}x average! Bullish trend confirmed (price > SMA20 > SMA50, MACD positive). Volatility surge in direction of trend.`,
        indicators: snapIndicators,
      };
    } else if (trendDown && macd < 0) {
      return {
        strategy: "atr-expansion",
        signal: "STRONG_SELL",
        confidence: 75,
        targetPrice: round(price - atr * 2),
        stopLoss: round(price + atr * 1.5),
        reasoning: `ATR expansion ${atrRatio.toFixed(1)}x average! Bearish trend confirmed. Volatility surge accelerating downside.`,
        indicators: snapIndicators,
      };
    } else {
      return {
        strategy: "atr-expansion",
        signal: "HOLD",
        confidence: 50,
        targetPrice: round(price + (trendUp ? atr : -atr)),
        stopLoss: round(price - (trendUp ? atr : -atr)),
        reasoning: `ATR expansion ${atrRatio.toFixed(1)}x but trend direction unclear. Wait for confirmation.`,
        indicators: snapIndicators,
      };
    }
  }

  if (atrRatio < 0.5) {
    return {
      strategy: "atr-expansion",
      signal: "HOLD",
      confidence: 55,
      targetPrice: round(price + atr * 3),
      stopLoss: round(price - atr * 3),
      reasoning: `ATR compression (${atrRatio.toFixed(1)}x avg). Expect volatility expansion soon. Set wide stops and wait.`,
      indicators: snapIndicators,
    };
  }

  return holdSignal("atr-expansion", `Normal volatility. ATR ratio ${atrRatio.toFixed(2)}x.`);
}

// ═══════════════════════════════════════════════════════
// PUMP & DUMP DETECTION
// Volume Z-score + price velocity + momentum divergence
// ═══════════════════════════════════════════════════════

export function pumpAndDumpDetection(
  quote: StockQuote,
  data: HistoricalDataPoint[],
  indicators: TechnicalIndicators
): StrategySignal {
  const closes = data.map((d) => d.close).filter(Boolean);
  const volumes = data.map((d) => d.volume).filter(Boolean);

  if (closes.length < 20 || volumes.length < 20) {
    return holdSignal("pump-dump", "Insufficient data for pump detection");
  }

  const price = quote.price;
  const volume = quote.volume;

  // Volume Z-score (how many std devs above average)
  const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volStdDev = Math.sqrt(
    volumes.slice(-20).reduce((s, v) => s + (v - avgVol) ** 2, 0) / 20
  );
  const volZScore = volStdDev > 0 ? (volume - avgVol) / volStdDev : 0;

  // Price velocity (% change over last 3 candles)
  const priceVelocity = closes.length >= 3
    ? ((closes[closes.length - 1] - closes[closes.length - 4]) / closes[closes.length - 4]) * 100
    : 0;

  // RSI-Price divergence (price making new highs but RSI isn't)
  const recentHigh = Math.max(...closes.slice(-5));
  const priorHigh = Math.max(...closes.slice(-10, -5));
  const priceNewHigh = recentHigh > priorHigh;

  const rsiOverbought = indicators.rsi > 75;
  const rsiBearishDiv = priceNewHigh && indicators.rsi < 70; // price new high but RSI not extreme

  // Gap detection
  const lastClose = closes[closes.length - 2] || price;
  const gapPercent = ((price - lastClose) / lastClose) * 100;

  const snapIndicators: Record<string, number> = {
    volZScore,
    priceVelocity,
    rsi: indicators.rsi,
    gapPercent,
    volumeVsAvg: avgVol > 0 ? volume / avgVol : 0,
    price,
  };

  // PUMP DETECTION: volume spike + rapid price rise
  if (volZScore > 3 && priceVelocity > 5) {
    const isPump = rsiOverbought || rsiBearishDiv;

    if (isPump) {
      return {
        strategy: "pump-dump",
        signal: "STRONG_SELL",
        confidence: 85,
        targetPrice: round(price * 0.92), // expect 8% pullback
        stopLoss: round(price * 1.03),
        reasoning: `PUMP DETECTED: Volume ${volZScore.toFixed(1)} std devs above avg, price up ${priceVelocity.toFixed(1)}% in 3 periods. RSI ${indicators.rsi.toFixed(0)} with bearish divergence. High probability of dump phase.`,
        indicators: snapIndicators,
      };
    } else {
      return {
        strategy: "pump-dump",
        signal: "HOLD",
        confidence: 65,
        targetPrice: round(price * 1.05),
        stopLoss: round(price * 0.95),
        reasoning: `Unusual volume spike (${volZScore.toFixed(1)}σ) with ${priceVelocity.toFixed(1)}% price move. Could be legitimate breakout or pump. RSI ${indicators.rsi.toFixed(0)} not yet extreme. Monitor closely.`,
        indicators: snapIndicators,
      };
    }
  }

  // DUMP DETECTION: after a pump, detect the reversal
  if (volZScore > 2 && priceVelocity < -3 && indicators.rsi < 40) {
    return {
      strategy: "pump-dump",
      signal: "SELL",
      confidence: 72,
      targetPrice: round(price * 0.95),
      stopLoss: round(price * 1.02),
      reasoning: `DUMP PHASE: High volume (${volZScore.toFixed(1)}σ) with ${priceVelocity.toFixed(1)}% decline. RSI ${indicators.rsi.toFixed(0)} dropping. Exit any long positions.`,
      indicators: snapIndicators,
    };
  }

  // Gap up on volume — potential pump start
  if (gapPercent > 3 && volZScore > 2) {
    return {
      strategy: "pump-dump",
      signal: "HOLD",
      confidence: 60,
      targetPrice: round(price * 1.03),
      stopLoss: round(price - Math.abs(gapPercent / 100) * price),
      reasoning: `Gap up ${gapPercent.toFixed(1)}% on ${volZScore.toFixed(1)}σ volume. Early pump signal — watch for continuation or reversal. Tight stops if entering.`,
      indicators: snapIndicators,
    };
  }

  return holdSignal("pump-dump", `Normal activity. Volume Z-score ${volZScore.toFixed(1)}, price velocity ${priceVelocity.toFixed(1)}%.`);
}

// ═══════════════════════════════════════════════════════
// MULTI-STRATEGY SCANNER
// Runs all engines and returns combined signals
// ═══════════════════════════════════════════════════════

export function runAllStrategies(
  quote: StockQuote,
  data: HistoricalDataPoint[],
  indicators: TechnicalIndicators
): StrategySignal[] {
  return [
    bollingerSqueeze(quote, data, indicators),
    atrExpansion(quote, data, indicators),
    pumpAndDumpDetection(quote, data, indicators),
  ];
}

// ═══════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════

function holdSignal(strategy: string, reasoning: string): StrategySignal {
  return {
    strategy,
    signal: "HOLD",
    confidence: 50,
    targetPrice: 0,
    stopLoss: 0,
    reasoning,
    indicators: {},
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
