// Vega Market Data Service - Multi-source for accuracy & speed
// Real-time quotes, historical data, news & sentiment

export interface StockQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  open: number;
  previousClose: number;
  volume: number;
  marketCap?: number;
  pe?: number;
  eps?: number;
  dividend?: number;
  week52High?: number;
  week52Low?: number;
  timestamp: number;
}

export interface HistoricalDataPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjClose: number;
}

export interface StockNews {
  title: string;
  summary: string;
  source: string;
  url: string;
  publishedAt: string;
  sentiment?: "positive" | "negative" | "neutral";
}

export interface TechnicalIndicators {
  sma20: number;
  sma50: number;
  sma200: number;
  ema12: number;
  ema26: number;
  macd: number;
  macdSignal: number;
  macdHistogram: number;
  rsi: number;
  bollingerUpper: number;
  bollingerMiddle: number;
  bollingerLower: number;
  atr: number;
  vwap: number;
}

// Market data provider API
export async function getQuote(symbol: string): Promise<StockQuote> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m&includePrePost=false`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; StockAI/1.0)",
    },
  });

  if (!res.ok) throw new Error(`Market data error: ${res.status}`);

  const data = (await res.json()) as any;
  const result = data.chart.result[0];
  const meta = result.meta;
  const quotes = result.indicators.quote[0];
  const lastIdx = quotes.close.length - 1;

  return {
    symbol: meta.symbol,
    name: meta.shortName || meta.longName || meta.symbol,
    price: meta.regularMarketPrice,
    change: meta.regularMarketPrice - meta.chartPreviousClose,
    changePercent:
      ((meta.regularMarketPrice - meta.chartPreviousClose) /
        meta.chartPreviousClose) *
      100,
    high: meta.regularMarketDayHigh || Math.max(...quotes.high.filter(Boolean)),
    low: meta.regularMarketDayLow || Math.min(...quotes.low.filter(Boolean)),
    open: quotes.open[0] || meta.regularMarketPrice,
    previousClose: meta.chartPreviousClose,
    volume: meta.regularMarketVolume || 0,
    marketCap: meta.marketCap,
    timestamp: Date.now(),
  };
}

// Get historical data for technical analysis
export async function getHistoricalData(
  symbol: string,
  range: string = "6mo",
  interval: string = "1d"
): Promise<HistoricalDataPoint[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; StockAI/1.0)" },
  });

  if (!res.ok) throw new Error(`Historical data error: ${res.status}`);

  const data = (await res.json()) as any;
  const result = data.chart.result[0];
  const timestamps = result.timestamp;
  const quotes = result.indicators.quote[0];
  const adjClose = result.indicators.adjclose?.[0]?.adjclose || quotes.close;

  return timestamps.map((ts: number, i: number) => ({
    date: new Date(ts * 1000).toISOString().split("T")[0],
    open: quotes.open[i] || 0,
    high: quotes.high[i] || 0,
    low: quotes.low[i] || 0,
    close: quotes.close[i] || 0,
    volume: quotes.volume[i] || 0,
    adjClose: adjClose[i] || quotes.close[i] || 0,
  }));
}

// Calculate technical indicators from historical data
export function calculateIndicators(
  data: HistoricalDataPoint[]
): TechnicalIndicators {
  const closes = data.map((d) => d.close).filter(Boolean);
  const highs = data.map((d) => d.high).filter(Boolean);
  const lows = data.map((d) => d.low).filter(Boolean);
  const volumes = data.map((d) => d.volume).filter(Boolean);

  const sma = (arr: number[], period: number) => {
    if (arr.length < period) return arr[arr.length - 1] || 0;
    const slice = arr.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
  };

  const ema = (arr: number[], period: number) => {
    if (arr.length < period) return sma(arr, arr.length);
    const k = 2 / (period + 1);
    let emaVal = sma(arr.slice(0, period), period);
    for (let i = period; i < arr.length; i++) {
      emaVal = arr[i] * k + emaVal * (1 - k);
    }
    return emaVal;
  };

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macd = ema12 - ema26;

  // MACD Signal line (9-period EMA of MACD)
  const macdValues: number[] = [];
  for (let i = 26; i < closes.length; i++) {
    const e12 = ema(closes.slice(0, i + 1), 12);
    const e26 = ema(closes.slice(0, i + 1), 26);
    macdValues.push(e12 - e26);
  }
  const macdSignal = macdValues.length >= 9 ? ema(macdValues, 9) : macd;

  // RSI (14-period)
  const rsiPeriod = 14;
  let gains = 0,
    losses = 0;
  const recentCloses = closes.slice(-rsiPeriod - 1);
  for (let i = 1; i < recentCloses.length; i++) {
    const diff = recentCloses[i] - recentCloses[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / rsiPeriod;
  const avgLoss = losses / rsiPeriod;
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);

  // Bollinger Bands (20-period, 2 std devs)
  const bb20 = closes.slice(-20);
  const bbMean = bb20.reduce((a, b) => a + b, 0) / bb20.length;
  const bbStdDev = Math.sqrt(
    bb20.reduce((sum, x) => sum + Math.pow(x - bbMean, 2), 0) / bb20.length
  );

  // ATR (14-period)
  const trueRanges: number[] = [];
  for (let i = 1; i < Math.min(15, data.length); i++) {
    const idx = data.length - 1 - i;
    if (idx < 0) break;
    const tr = Math.max(
      highs[idx] - lows[idx],
      Math.abs(highs[idx] - closes[idx - 1] || 0),
      Math.abs(lows[idx] - closes[idx - 1] || 0)
    );
    trueRanges.push(tr);
  }
  const atr =
    trueRanges.length > 0
      ? trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length
      : 0;

  // VWAP (current day approximation)
  const lastN = Math.min(20, closes.length);
  const recentC = closes.slice(-lastN);
  const recentV = volumes.slice(-lastN);
  const totalVP = recentC.reduce((sum, c, i) => sum + c * recentV[i], 0);
  const totalV = recentV.reduce((a, b) => a + b, 0);
  const vwap = totalV > 0 ? totalVP / totalV : closes[closes.length - 1];

  return {
    sma20,
    sma50,
    sma200,
    ema12,
    ema26,
    macd,
    macdSignal,
    macdHistogram: macd - macdSignal,
    rsi,
    bollingerUpper: bbMean + 2 * bbStdDev,
    bollingerMiddle: bbMean,
    bollingerLower: bbMean - 2 * bbStdDev,
    atr,
    vwap,
  };
}

// Search for stock symbols
export async function searchSymbol(
  query: string
): Promise<Array<{ symbol: string; name: string; type: string; exchange: string }>> {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; StockAI/1.0)" },
  });

  if (!res.ok) return [];

  const data = (await res.json()) as any;
  return (data.quotes || []).map((q: any) => ({
    symbol: q.symbol,
    name: q.shortname || q.longname || q.symbol,
    type: q.quoteType || "EQUITY",
    exchange: q.exchange || "",
  }));
}

// Get market movers (top gainers/losers)
export async function getMarketMovers(): Promise<{
  gainers: StockQuote[];
  losers: StockQuote[];
  mostActive: StockQuote[];
}> {
  const symbols = {
    gainers: [
      "^NSEI",
      "^BSESN",
      "^NSEBANK",
      "^CNXIT",
      "RELIANCE.NS",
      "TCS.NS",
      "HDFCBANK.NS",
      "INFY.NS",
      "ICICIBANK.NS",
      "SBIN.NS",
    ],
  };

  const quotes = await Promise.all(
    symbols.gainers.map(async (s) => {
      try {
        return await getQuote(s);
      } catch {
        return null;
      }
    })
  );

  const valid = quotes.filter(Boolean) as StockQuote[];
  const sorted = [...valid].sort((a, b) => b.changePercent - a.changePercent);

  return {
    gainers: sorted.filter((q) => q.changePercent > 0).slice(0, 5),
    losers: sorted.filter((q) => q.changePercent < 0).slice(0, 5),
    mostActive: [...valid].sort((a, b) => b.volume - a.volume).slice(0, 5),
  };
}

// Get stock news via market data feed
export async function getStockNews(symbol: string): Promise<StockNews[]> {
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=0&newsCount=10`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; StockAI/1.0)" },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    return (data.news || []).map((n: any) => ({
      title: n.title || "",
      summary: n.publisher || "",
      source: n.publisher || "Market News",
      url: n.link || "",
      publishedAt: n.providerPublishTime
        ? new Date(n.providerPublishTime * 1000).toISOString()
        : new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}
