// Vega News Sentiment Pipeline — NLP scoring + volume confirmation → trade signals

import { type StockQuote, type StockNews, getStockNews } from "./stock-data";

export interface SentimentScore {
  symbol: string;
  overallScore: number;     // -1.0 (bearish) to +1.0 (bullish)
  articleCount: number;
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  confidence: number;       // 0-100, higher = more articles agree
  topHeadlines: ScoredHeadline[];
  timestamp: string;
}

export interface ScoredHeadline {
  title: string;
  source: string;
  score: number;           // -1.0 to 1.0
  magnitude: number;       // 0-1, how strong the sentiment
}

export interface NewsSentimentSignal {
  strategy: "news-sentiment";
  signal: "STRONG_BUY" | "BUY" | "HOLD" | "SELL" | "STRONG_SELL";
  confidence: number;
  targetPrice: number;
  stopLoss: number;
  reasoning: string;
  indicators: Record<string, number>;
  sentimentDetails: SentimentScore;
}

// ═══════════════════════════════════════════════════════
// KEYWORD-BASED NLP SENTIMENT SCORING
// Lexicon approach — fast, no external API needed
// ═══════════════════════════════════════════════════════

const BULLISH_WORDS = new Set([
  "surge", "surges", "surging", "soar", "soars", "soaring", "rally", "rallies", "rallying",
  "gain", "gains", "gained", "rise", "rises", "rising", "jump", "jumps", "jumped",
  "breakout", "bull", "bullish", "upgrade", "upgrades", "upgraded", "outperform",
  "beat", "beats", "exceeded", "exceeds", "strong", "strength", "growth", "grows",
  "profit", "profitable", "record", "high", "highs", "boom", "booming", "recovery",
  "optimism", "optimistic", "positive", "buy", "accumulate", "overweight",
  "breakthrough", "innovation", "expansion", "revenue", "earnings", "dividend",
  "approval", "approved", "partnership", "deal", "acquisition", "momentum",
  "upside", "outperformance", "catalyst", "opportunity", "demand",
]);

const BEARISH_WORDS = new Set([
  "crash", "crashes", "crashing", "plunge", "plunges", "plunging", "drop", "drops", "dropped",
  "fall", "falls", "falling", "decline", "declines", "declining", "tumble", "tumbles",
  "sell", "selloff", "selling", "downgrade", "downgrades", "downgraded", "underperform",
  "miss", "misses", "missed", "weak", "weakness", "loss", "losses", "losing",
  "bear", "bearish", "risk", "risks", "risky", "warning", "warns", "warned",
  "concern", "concerns", "worried", "fear", "fears", "panic", "recession",
  "layoff", "layoffs", "cut", "cuts", "slash", "slashes", "debt", "default",
  "investigation", "fraud", "scandal", "lawsuit", "fine", "penalty", "violation",
  "downside", "overvalued", "bubble", "correction", "bankruptcy", "restructuring",
  "inflation", "headwind", "volatility", "uncertainty", "turmoil",
]);

const AMPLIFIERS = new Set([
  "very", "extremely", "significantly", "substantially", "dramatically",
  "sharply", "massive", "huge", "major", "critical",
]);

const NEGATORS = new Set([
  "not", "no", "never", "neither", "nor", "barely", "hardly",
  "despite", "although", "however", "but",
]);

function scoreText(text: string): { score: number; magnitude: number } {
  const words = text.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/);
  let rawScore = 0;
  let totalSentimentWords = 0;
  let amplified = false;
  let negated = false;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];

    if (NEGATORS.has(word)) {
      negated = true;
      continue;
    }
    if (AMPLIFIERS.has(word)) {
      amplified = true;
      continue;
    }

    let wordScore = 0;
    if (BULLISH_WORDS.has(word)) {
      wordScore = 1;
      totalSentimentWords++;
    } else if (BEARISH_WORDS.has(word)) {
      wordScore = -1;
      totalSentimentWords++;
    }

    if (wordScore !== 0) {
      if (negated) wordScore *= -0.7; // partial negation
      if (amplified) wordScore *= 1.5;
      rawScore += wordScore;
    }

    // Reset modifiers after use
    if (wordScore !== 0 || (!NEGATORS.has(word) && !AMPLIFIERS.has(word))) {
      negated = false;
      amplified = false;
    }
  }

  // Normalize score to -1..1
  const maxPossible = Math.max(totalSentimentWords, 1) * 1.5;
  const score = Math.max(-1, Math.min(1, rawScore / maxPossible));

  // Magnitude = how many sentiment words relative to text length
  const magnitude = Math.min(1, totalSentimentWords / Math.max(words.length * 0.1, 1));

  return { score, magnitude };
}

// ═══════════════════════════════════════════════════════
// AGGREGATE SENTIMENT FROM MULTIPLE ARTICLES
// ═══════════════════════════════════════════════════════

export async function analyzeSentiment(symbol: string): Promise<SentimentScore> {
  const news = await getStockNews(symbol);

  if (!news || news.length === 0) {
    return {
      symbol, overallScore: 0, articleCount: 0,
      positiveCount: 0, negativeCount: 0, neutralCount: 0,
      confidence: 0, topHeadlines: [], timestamp: new Date().toISOString(),
    };
  }

  const scored: ScoredHeadline[] = news.map((article) => {
    // Score both title and summary (title weighted 2x)
    const titleScore = scoreText(article.title);
    const summaryScore = article.summary ? scoreText(article.summary) : { score: 0, magnitude: 0 };

    const combinedScore = (titleScore.score * 2 + summaryScore.score) / 3;
    const combinedMagnitude = Math.max(titleScore.magnitude, summaryScore.magnitude);

    return {
      title: article.title,
      source: article.source,
      score: Math.round(combinedScore * 100) / 100,
      magnitude: Math.round(combinedMagnitude * 100) / 100,
    };
  });

  // Aggregate
  const positiveCount = scored.filter((s) => s.score > 0.15).length;
  const negativeCount = scored.filter((s) => s.score < -0.15).length;
  const neutralCount = scored.length - positiveCount - negativeCount;

  // Weighted average: high-magnitude articles count more
  const totalWeight = scored.reduce((sum, s) => sum + Math.max(0.1, s.magnitude), 0);
  const weightedScore = scored.reduce(
    (sum, s) => sum + s.score * Math.max(0.1, s.magnitude), 0
  ) / totalWeight;

  // Confidence: how much do articles agree?
  const scores = scored.map((s) => s.score);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / scores.length;
  const agreement = 1 - Math.min(1, Math.sqrt(variance)); // low variance = high agreement
  const confidence = Math.round(agreement * Math.min(scored.length / 3, 1) * 100);

  return {
    symbol,
    overallScore: Math.round(weightedScore * 100) / 100,
    articleCount: scored.length,
    positiveCount,
    negativeCount,
    neutralCount,
    confidence,
    topHeadlines: scored.sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 5),
    timestamp: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════
// GENERATE TRADE SIGNAL FROM SENTIMENT + VOLUME
// ═══════════════════════════════════════════════════════

export function sentimentToSignal(
  sentiment: SentimentScore,
  quote: StockQuote,
  avgVolume: number,
  atr: number,
): NewsSentimentSignal {
  const volumeRatio = avgVolume > 0 ? quote.volume / avgVolume : 1;
  const priceChange = quote.changePercent;

  const indicators: Record<string, number> = {
    sentimentScore: sentiment.overallScore,
    confidence: sentiment.confidence,
    articleCount: sentiment.articleCount,
    volumeRatio,
    priceChangePercent: priceChange,
  };

  // Need: sentiment alignment + volume confirmation + price movement
  const bullishSentiment = sentiment.overallScore > 0.3;
  const bearishSentiment = sentiment.overallScore < -0.3;
  const strongBullish = sentiment.overallScore > 0.6;
  const strongBearish = sentiment.overallScore < -0.6;
  const volumeSpike = volumeRatio > 1.5;
  const highConfidence = sentiment.confidence > 60;

  const hold = (): NewsSentimentSignal => ({
    strategy: "news-sentiment",
    signal: "HOLD",
    confidence: 50,
    targetPrice: 0,
    stopLoss: 0,
    reasoning: `Neutral sentiment (score: ${sentiment.overallScore.toFixed(2)}, ${sentiment.articleCount} articles). No actionable news signal.`,
    indicators,
    sentimentDetails: sentiment,
  });

  if (sentiment.articleCount < 2) {
    return {
      ...hold(),
      reasoning: `Insufficient news data (${sentiment.articleCount} articles). Need 2+ for reliable sentiment.`,
    };
  }

  // STRONG_BUY: very bullish sentiment + volume surge + price momentum
  if (strongBullish && volumeSpike && priceChange > 1 && highConfidence) {
    return {
      strategy: "news-sentiment",
      signal: "STRONG_BUY",
      confidence: Math.min(90, sentiment.confidence + 15),
      targetPrice: round(quote.price + atr * 2.5),
      stopLoss: round(quote.price - atr * 1.5),
      reasoning: `Strong bullish sentiment (${sentiment.overallScore.toFixed(2)}) from ${sentiment.articleCount} articles with ${(volumeRatio).toFixed(1)}x volume surge. Price already +${priceChange.toFixed(1)}% confirming news impact.`,
      indicators,
      sentimentDetails: sentiment,
    };
  }

  // BUY: bullish sentiment + some volume
  if (bullishSentiment && highConfidence) {
    return {
      strategy: "news-sentiment",
      signal: "BUY",
      confidence: Math.min(80, sentiment.confidence + 5),
      targetPrice: round(quote.price + atr * 2),
      stopLoss: round(quote.price - atr * 1.5),
      reasoning: `Bullish news sentiment (${sentiment.overallScore.toFixed(2)}) across ${sentiment.positiveCount}/${sentiment.articleCount} positive articles.${volumeSpike ? ` Volume ${(volumeRatio).toFixed(1)}x confirms.` : ""}`,
      indicators,
      sentimentDetails: sentiment,
    };
  }

  // STRONG_SELL: very bearish + volume
  if (strongBearish && volumeSpike && priceChange < -1 && highConfidence) {
    return {
      strategy: "news-sentiment",
      signal: "STRONG_SELL",
      confidence: Math.min(90, sentiment.confidence + 15),
      targetPrice: round(quote.price - atr * 2.5),
      stopLoss: round(quote.price + atr * 1.5),
      reasoning: `Strong bearish sentiment (${sentiment.overallScore.toFixed(2)}) with ${(volumeRatio).toFixed(1)}x volume and ${priceChange.toFixed(1)}% decline. Exit or short.`,
      indicators,
      sentimentDetails: sentiment,
    };
  }

  // SELL: bearish sentiment
  if (bearishSentiment && highConfidence) {
    return {
      strategy: "news-sentiment",
      signal: "SELL",
      confidence: Math.min(80, sentiment.confidence + 5),
      targetPrice: round(quote.price - atr * 2),
      stopLoss: round(quote.price + atr * 1.5),
      reasoning: `Bearish news sentiment (${sentiment.overallScore.toFixed(2)}) across ${sentiment.negativeCount}/${sentiment.articleCount} negative articles. Caution advised.`,
      indicators,
      sentimentDetails: sentiment,
    };
  }

  return hold();
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
