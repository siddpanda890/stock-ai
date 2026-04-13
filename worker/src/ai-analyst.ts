// AI Stock Analyst - Uses Claude via Vertex AI for deep analysis & buy/sell signals

import { callClaude, type ModelKey } from "./vertex-ai";
import {
  type StockQuote,
  type HistoricalDataPoint,
  type TechnicalIndicators,
} from "./stock-data";

export interface AnalysisResult {
  symbol: string;
  signal: "STRONG_BUY" | "BUY" | "HOLD" | "SELL" | "STRONG_SELL";
  confidence: number; // 0-100
  targetPrice: number;
  stopLoss: number;
  summary: string;
  technicalAnalysis: string;
  riskAssessment: string;
  catalysts: string[];
  timeHorizon: string;
  model: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface Env {
  VERTEX_PROJECT_ID: string;
  VERTEX_LOCATION: string;
  VERTEX_SERVICE_ACCOUNT_JSON: string;
  ANTHROPIC_API_KEY: string;
}

const SYSTEM_PROMPT = `You are an elite AI stock analyst with deep expertise in technical analysis, fundamental analysis, and quantitative trading. You work for a hedge fund and provide precise, actionable analysis.

Your analysis framework:
1. TECHNICAL: Price action, moving averages, MACD, RSI, Bollinger Bands, volume analysis, support/resistance levels, chart patterns
2. FUNDAMENTAL: Earnings, revenue growth, margins, valuation (P/E, PEG, P/S), competitive moat, management quality
3. SENTIMENT: Market positioning, institutional flows, short interest, options flow
4. MACRO: Fed policy impact, sector rotation, economic indicators

When giving buy/sell signals:
- STRONG_BUY: Multiple bullish confirmations across technical, fundamental, and sentiment. >80% confidence.
- BUY: Bullish bias with some confirming signals. 60-80% confidence.
- HOLD: Mixed signals or consolidation phase. Watch for breakout direction.
- SELL: Bearish signals with deteriorating fundamentals or technical breakdown. 60-80% confidence.
- STRONG_SELL: Multiple bearish confirmations, broken support, deteriorating fundamentals. >80% confidence.

Always provide:
- A specific target price with reasoning
- A stop-loss level for risk management
- Risk/reward ratio
- Time horizon for the trade
- Key catalysts (earnings, product launches, macro events)

IMPORTANT: Always remind users that this is AI-generated analysis for educational purposes, not financial advice. They should do their own research and consult a financial advisor.

Respond in valid JSON when asked for structured analysis.`;

export async function analyzeStock(
  env: Env,
  quote: StockQuote,
  historicalData: HistoricalDataPoint[],
  indicators: TechnicalIndicators,
  model: ModelKey = "sonnet-4.6"
): Promise<AnalysisResult> {
  const dataContext = `
STOCK: ${quote.symbol} (${quote.name})
CURRENT PRICE: $${quote.price.toFixed(2)}
CHANGE: ${quote.change >= 0 ? "+" : ""}${quote.change.toFixed(2)} (${quote.changePercent.toFixed(2)}%)
DAY RANGE: $${quote.low.toFixed(2)} - $${quote.high.toFixed(2)}
VOLUME: ${(quote.volume / 1e6).toFixed(2)}M
${quote.marketCap ? `MARKET CAP: $${(quote.marketCap / 1e9).toFixed(2)}B` : ""}

TECHNICAL INDICATORS:
- SMA 20: $${indicators.sma20.toFixed(2)} | SMA 50: $${indicators.sma50.toFixed(2)} | SMA 200: $${indicators.sma200.toFixed(2)}
- MACD: ${indicators.macd.toFixed(4)} | Signal: ${indicators.macdSignal.toFixed(4)} | Histogram: ${indicators.macdHistogram.toFixed(4)}
- RSI (14): ${indicators.rsi.toFixed(2)}
- Bollinger: Upper $${indicators.bollingerUpper.toFixed(2)} | Mid $${indicators.bollingerMiddle.toFixed(2)} | Lower $${indicators.bollingerLower.toFixed(2)}
- ATR (14): $${indicators.atr.toFixed(2)}
- VWAP: $${indicators.vwap.toFixed(2)}

RECENT PRICE HISTORY (last 10 days):
${historicalData
  .slice(-10)
  .map(
    (d) =>
      `${d.date}: O:$${d.open.toFixed(2)} H:$${d.high.toFixed(2)} L:$${d.low.toFixed(2)} C:$${d.close.toFixed(2)} V:${(d.volume / 1e6).toFixed(1)}M`
  )
  .join("\n")}
`;

  const prompt = `Analyze ${quote.symbol} and provide a trading recommendation. Return your analysis as a JSON object with exactly these fields:
{
  "signal": "STRONG_BUY" | "BUY" | "HOLD" | "SELL" | "STRONG_SELL",
  "confidence": <number 0-100>,
  "targetPrice": <number>,
  "stopLoss": <number>,
  "summary": "<2-3 sentence executive summary>",
  "technicalAnalysis": "<detailed technical breakdown>",
  "riskAssessment": "<risk factors and mitigation>",
  "catalysts": ["<catalyst 1>", "<catalyst 2>", ...],
  "timeHorizon": "<e.g., 1-2 weeks, 1-3 months>"
}

Here is the current data:
${dataContext}

Respond ONLY with the JSON object, no markdown or extra text.`;

  const config = {
    projectId: env.VERTEX_PROJECT_ID,
    location: env.VERTEX_LOCATION,
    serviceAccountJson: env.VERTEX_SERVICE_ACCOUNT_JSON,
  };

  const response = await callClaude(
    config,
    env.ANTHROPIC_API_KEY,
    [{ role: "user", content: prompt }],
    SYSTEM_PROMPT,
    model,
    4096
  );

  const text = response.content[0]?.text || "{}";

  // Parse JSON - handle potential markdown wrapping
  const jsonStr = text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
  const analysis = JSON.parse(jsonStr);

  return {
    symbol: quote.symbol,
    signal: analysis.signal,
    confidence: analysis.confidence,
    targetPrice: analysis.targetPrice,
    stopLoss: analysis.stopLoss,
    summary: analysis.summary,
    technicalAnalysis: analysis.technicalAnalysis,
    riskAssessment: analysis.riskAssessment,
    catalysts: analysis.catalysts || [],
    timeHorizon: analysis.timeHorizon,
    model: model,
  };
}

export async function chat(
  env: Env,
  messages: ChatMessage[],
  stockContext?: string,
  model: ModelKey = "sonnet-4.6"
): Promise<string> {
  const config = {
    projectId: env.VERTEX_PROJECT_ID,
    location: env.VERTEX_LOCATION,
    serviceAccountJson: env.VERTEX_SERVICE_ACCOUNT_JSON,
  };

  const systemWithContext = stockContext
    ? `${SYSTEM_PROMPT}\n\nCurrent market context:\n${stockContext}`
    : SYSTEM_PROMPT;

  const response = await callClaude(
    config,
    env.ANTHROPIC_API_KEY,
    messages,
    systemWithContext,
    model,
    4096
  );

  return response.content[0]?.text || "I could not generate a response.";
}
