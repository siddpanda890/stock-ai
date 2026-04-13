// API client for Stock AI Worker backend

const API_BASE = import.meta.env.VITE_API_URL || "";

async function fetchAPI<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || "API error");
  return json.data;
}

export interface Quote {
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
  timestamp: number;
}

export interface HistoryPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Indicators {
  sma20: number;
  sma50: number;
  sma200: number;
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

export interface Analysis {
  symbol: string;
  signal: string;
  confidence: number;
  targetPrice: number;
  stopLoss: number;
  summary: string;
  technicalAnalysis: string;
  riskAssessment: string;
  catalysts: string[];
  timeHorizon: string;
  model: string;
}

export interface AnalysisResponse {
  quote: Quote;
  indicators: Indicators;
  analysis: Analysis;
  disclaimer: string;
}

export const api = {
  getQuote: (symbol: string) => fetchAPI<Quote>(`/api/quote/${symbol}`),

  getHistory: (symbol: string, range = "6mo") =>
    fetchAPI<{ history: HistoryPoint[]; indicators: Indicators }>(
      `/api/history/${symbol}?range=${range}`
    ),

  search: (q: string) =>
    fetchAPI<Array<{ symbol: string; name: string; type: string }>>(
      `/api/search?q=${encodeURIComponent(q)}`
    ),

  analyze: (symbol: string, model = "sonnet-4.6") =>
    fetchAPI<AnalysisResponse>("/api/analyze", {
      method: "POST",
      body: JSON.stringify({ symbol, model }),
    }),

  chat: (
    messages: Array<{ role: string; content: string }>,
    symbol?: string,
    model = "sonnet-4.6"
  ) =>
    fetchAPI<{ response: string; model: string }>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ messages, symbol, model }),
    }),

  getWatchlist: (symbols: string[]) =>
    fetchAPI<Quote[]>("/api/watchlist", {
      method: "POST",
      body: JSON.stringify({ symbols }),
    }),

  getMarket: () =>
    fetchAPI<{ gainers: Quote[]; losers: Quote[]; mostActive: Quote[] }>(
      "/api/market"
    ),
};
