// API client for Stock AI Worker backend — with Auth support

const API_BASE = import.meta.env.VITE_API_URL || "";

function getToken(): string | null {
  try { return JSON.parse(localStorage.getItem("stock-ai-auth") || "null")?.token; } catch { return null; }
}

async function fetchAPI<T>(path: string, options?: RequestInit & { auth?: boolean }): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options?.auth !== false) {
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers: { ...headers, ...options?.headers } });
  const json = await res.json();
  if (!json.success) {
    if (res.status === 401) { localStorage.removeItem("stock-ai-auth"); window.location.reload(); }
    throw new Error(json.error || "API error");
  }
  return json.data;
}

export interface Quote { symbol:string; name:string; price:number; change:number; changePercent:number; high:number; low:number; open:number; previousClose:number; volume:number; marketCap?:number; timestamp:number; }
export interface HistoryPoint { date:string; open:number; high:number; low:number; close:number; volume:number; }
export interface Indicators { sma20:number; sma50:number; sma200:number; macd:number; macdSignal:number; macdHistogram:number; rsi:number; bollingerUpper:number; bollingerMiddle:number; bollingerLower:number; atr:number; vwap:number; }
export interface Analysis { symbol:string; signal:string; confidence:number; targetPrice:number; stopLoss:number; summary:string; technicalAnalysis:string; riskAssessment:string; catalysts:string[]; timeHorizon:string; model:string; }
export interface AnalysisResponse { quote:Quote; indicators:Indicators; analysis:Analysis; disclaimer:string; }
export interface UserPublic { id:string; username:string; email:string; createdAt:string; lastLogin:string; settings:any; }
export interface PortfolioData { holdings:any[]; trades:any[]; cash:number; totalInvested:number; totalValue:number; totalPnl:number; totalPnlPercent:number; triggeredAlerts?:any[]; }
export interface Alert { id:string; symbol:string; type:string; value:number; triggered:boolean; createdAt:string; triggeredAt?:string; message?:string; }

export const api = {
  // Auth
  register: (username:string, email:string, password:string) =>
    fetchAPI<{user:UserPublic;token:string}>("/api/auth/register", { method:"POST", body:JSON.stringify({username,email,password}), auth:false }),
  login: (username:string, password:string) =>
    fetchAPI<{user:UserPublic;token:string}>("/api/auth/login", { method:"POST", body:JSON.stringify({username,password}), auth:false }),
  me: () => fetchAPI<UserPublic>("/api/auth/me"),

  // Public stock data
  getQuote: (symbol:string) => fetchAPI<Quote>(`/api/quote/${symbol}`, {auth:false}),
  getHistory: (symbol:string, range="6mo") => fetchAPI<{history:HistoryPoint[];indicators:Indicators}>(`/api/history/${symbol}?range=${range}`, {auth:false}),
  search: (q:string) => fetchAPI<Array<{symbol:string;name:string;type:string}>>(`/api/search?q=${encodeURIComponent(q)}`, {auth:false}),
  getMarket: () => fetchAPI<{gainers:Quote[];losers:Quote[];mostActive:Quote[]}>("/api/market", {auth:false}),
  getNews: (symbol:string) => fetchAPI<any[]>(`/api/news/${symbol}`, {auth:false}),
  getWatchlist: (symbols:string[]) => fetchAPI<Quote[]>("/api/watchlist", { method:"POST", body:JSON.stringify({symbols}), auth:false }),

  // AI
  analyze: (symbol:string, model="sonnet-4.6") => fetchAPI<AnalysisResponse>("/api/analyze", { method:"POST", body:JSON.stringify({symbol,model}) }),
  chat: (messages:Array<{role:string;content:string}>, symbol?:string, model="sonnet-4.6") =>
    fetchAPI<{response:string;model:string}>("/api/chat", { method:"POST", body:JSON.stringify({messages,symbol,model}) }),

  // User (protected)
  getUserWatchlist: () => fetchAPI<Quote[]>("/api/user/watchlist"),
  addToWatchlist: (symbol:string) => fetchAPI<string[]>("/api/user/watchlist/add", { method:"POST", body:JSON.stringify({symbol}) }),
  removeFromWatchlist: (symbol:string) => fetchAPI<string[]>("/api/user/watchlist/remove", { method:"POST", body:JSON.stringify({symbol}) }),

  getPortfolio: () => fetchAPI<PortfolioData>("/api/user/portfolio"),
  resetPortfolio: (cash = 100000) => fetchAPI<any>("/api/user/portfolio/reset", { method: "POST", body: JSON.stringify({ cash }) }),
  buy: (symbol:string, quantity:number, price:number, notes?:string) =>
    fetchAPI<any>("/api/user/portfolio/buy", { method:"POST", body:JSON.stringify({symbol,quantity,price,notes}) }),
  sell: (symbol:string, quantity:number, price:number, notes?:string) =>
    fetchAPI<any>("/api/user/portfolio/sell", { method:"POST", body:JSON.stringify({symbol,quantity,price,notes}) }),

  getAlerts: () => fetchAPI<Alert[]>("/api/user/alerts"),
  createAlert: (symbol:string, type:string, value:number, message?:string) =>
    fetchAPI<Alert>("/api/user/alerts", { method:"POST", body:JSON.stringify({symbol,type,value,message}) }),
  deleteAlert: (alertId:string) => fetchAPI<any>(`/api/user/alerts/${alertId}`, { method:"DELETE" }),

  updateSettings: (settings:any) => fetchAPI<UserPublic>("/api/user/settings", { method:"PUT", body:JSON.stringify(settings) }),
};

// Auth state helpers
export function saveAuth(user: UserPublic, token: string) {
  localStorage.setItem("stock-ai-auth", JSON.stringify({ user, token }));
}
export function getAuth(): { user: UserPublic; token: string } | null {
  try { return JSON.parse(localStorage.getItem("stock-ai-auth") || "null"); } catch { return null; }
}
export function logout() {
  localStorage.removeItem("stock-ai-auth");
  window.location.reload();
}
