// Portfolio Management System - Buy/Sell tracking, P&L, Holdings

export interface Trade {
  id: string;
  symbol: string;
  type: "BUY" | "SELL";
  quantity: number;
  price: number;
  total: number;
  timestamp: string;
  notes?: string;
}

export interface Holding {
  symbol: string;
  quantity: number;
  avgCost: number;
  totalInvested: number;
}

export interface Portfolio {
  holdings: Holding[];
  trades: Trade[];
  cash: number;
  initialCapital: number;
  realizedPnl: number;  // running total of all realized P&L
  totalTradeCount: number;
  winCount: number;
}

export interface PortfolioSummary {
  holdings: Array<Holding & {
    currentPrice?: number;
    currentValue?: number;
    pnl?: number;
    pnlPercent?: number;
  }>;
  trades: Trade[];
  cash: number;
  totalInvested: number;
  totalValue: number;
  totalPnl: number;
  totalPnlPercent: number;
}

const DEFAULT_WATCHLIST = [
  "RELIANCE.NS",
  "TCS.NS",
  "HDFCBANK.NS",
  "INFY.NS",
  "ICICIBANK.NS",
  "HINDUNILVR.NS",
  "ITC.NS",
  "WIPRO.NS",
  "AXISBANK.NS",
  "BAJFINANCE.NS",
  "TATAMOTORS.NS",
  "SUNPHARMA.NS",
  "ADANIENT.NS",
  "MARUTI.NS",
  "KOTAKBANK.NS",
];

// Get portfolio from KV
export async function getPortfolio(kv: KVNamespace, userId: string): Promise<Portfolio> {
  const data = await kv.get(`portfolio:${userId}`);
  if (!data) {
    return {
      holdings: [],
      trades: [],
      cash: 100000,
      initialCapital: 100000,
      realizedPnl: 0,
      totalTradeCount: 0,
      winCount: 0,
    };
  }
  const parsed = JSON.parse(data);
  // Backfill for existing portfolios missing new fields
  return {
    ...parsed,
    initialCapital: parsed.initialCapital ?? 100000,
    realizedPnl: parsed.realizedPnl ?? 0,
    totalTradeCount: parsed.totalTradeCount ?? parsed.trades?.length ?? 0,
    winCount: parsed.winCount ?? 0,
  };
}

// Save portfolio to KV
async function savePortfolio(kv: KVNamespace, userId: string, portfolio: Portfolio): Promise<void> {
  await kv.put(`portfolio:${userId}`, JSON.stringify(portfolio));
}

// ─── Trade Rate Limiter ─────────────────────────────
// Prevents rapid-fire automated trades (max 1 trade per symbol per 30s)
async function checkTradeRateLimit(
  kv: KVNamespace,
  userId: string,
  symbol: string,
  type: "BUY" | "SELL"
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const key = `ratelimit:trade:${userId}:${symbol}:${type}`;
  const last = await kv.get(key);
  if (last) {
    const elapsed = Date.now() - parseInt(last);
    if (elapsed < 30000) { // 30 second cooldown
      return { allowed: false, retryAfter: Math.ceil((30000 - elapsed) / 1000) };
    }
  }
  await kv.put(key, Date.now().toString(), { expirationTtl: 60 }); // auto-expire in 60s
  return { allowed: true };
}

// Execute a buy trade
export async function executeBuy(
  kv: KVNamespace,
  userId: string,
  symbol: string,
  quantity: number,
  price: number,
  notes?: string
): Promise<{ success: true; trade: Trade; portfolio: Portfolio } | { success: false; error: string }> {
  // Rate limit check
  const rateCheck = await checkTradeRateLimit(kv, userId, symbol, "BUY");
  if (!rateCheck.allowed) {
    return { success: false, error: `Rate limited: wait ${rateCheck.retryAfter}s before trading ${symbol} again` };
  }

  const portfolio = await getPortfolio(kv, userId);
  const total = quantity * price;

  if (total > portfolio.cash) {
    return { success: false, error: `Insufficient cash. Available: $${portfolio.cash.toFixed(2)}, Required: $${total.toFixed(2)}` };
  }

  const trade: Trade = {
    id: crypto.randomUUID(),
    symbol: symbol.toUpperCase(),
    type: "BUY",
    quantity,
    price,
    total,
    timestamp: new Date().toISOString(),
    notes,
  };

  // Update holding
  const existingIdx = portfolio.holdings.findIndex(h => h.symbol === symbol.toUpperCase());
  if (existingIdx >= 0) {
    const h = portfolio.holdings[existingIdx];
    const newTotal = h.totalInvested + total;
    const newQty = h.quantity + quantity;
    portfolio.holdings[existingIdx] = {
      symbol: h.symbol,
      quantity: newQty,
      avgCost: newTotal / newQty,
      totalInvested: newTotal,
    };
  } else {
    portfolio.holdings.push({
      symbol: symbol.toUpperCase(),
      quantity,
      avgCost: price,
      totalInvested: total,
    });
  }

  portfolio.cash -= total;
  portfolio.totalTradeCount += 1;
  portfolio.trades.unshift(trade); // newest first

  // Keep trades list manageable (last 500)
  if (portfolio.trades.length > 500) portfolio.trades = portfolio.trades.slice(0, 500);

  await savePortfolio(kv, userId, portfolio);
  return { success: true, trade, portfolio };
}

// Execute a sell trade
export async function executeSell(
  kv: KVNamespace,
  userId: string,
  symbol: string,
  quantity: number,
  price: number,
  notes?: string
): Promise<{ success: true; trade: Trade; portfolio: Portfolio; realizedPnl: number } | { success: false; error: string }> {
  const sym = symbol.toUpperCase();

  // Rate limit check
  const rateCheck = await checkTradeRateLimit(kv, userId, sym, "SELL");
  if (!rateCheck.allowed) {
    return { success: false, error: `Rate limited: wait ${rateCheck.retryAfter}s before selling ${sym} again` };
  }

  const portfolio = await getPortfolio(kv, userId);

  const holdingIdx = portfolio.holdings.findIndex(h => h.symbol === sym);
  if (holdingIdx < 0) {
    return { success: false, error: `No holding found for ${sym}` };
  }

  const holding = portfolio.holdings[holdingIdx];
  if (quantity > holding.quantity) {
    return { success: false, error: `Insufficient shares. You have ${holding.quantity} shares of ${sym}` };
  }

  const total = quantity * price;
  const costBasis = quantity * holding.avgCost;
  const realizedPnl = total - costBasis;

  const trade: Trade = {
    id: crypto.randomUUID(),
    symbol: sym,
    type: "SELL",
    quantity,
    price,
    total,
    timestamp: new Date().toISOString(),
    notes,
  };

  // Update holding
  if (quantity === holding.quantity) {
    portfolio.holdings.splice(holdingIdx, 1); // remove
  } else {
    portfolio.holdings[holdingIdx] = {
      ...holding,
      quantity: holding.quantity - quantity,
      totalInvested: holding.totalInvested - costBasis,
    };
  }

  portfolio.cash += total;
  portfolio.realizedPnl += realizedPnl;
  portfolio.totalTradeCount += 1;
  if (realizedPnl > 0) portfolio.winCount += 1;
  portfolio.trades.unshift(trade);

  // Keep trades list manageable (last 500)
  if (portfolio.trades.length > 500) portfolio.trades = portfolio.trades.slice(0, 500);

  await savePortfolio(kv, userId, portfolio);
  return { success: true, trade, portfolio, realizedPnl };
}

// ─── Alerts System ────────────────────────────────────

export interface Alert {
  id: string;
  symbol: string;
  type: "PRICE_ABOVE" | "PRICE_BELOW" | "PERCENT_CHANGE";
  value: number;
  triggered: boolean;
  createdAt: string;
  triggeredAt?: string;
  message?: string;
}

export async function getAlerts(kv: KVNamespace, userId: string): Promise<Alert[]> {
  const data = await kv.get(`alerts:${userId}`);
  if (!data) return [];
  return JSON.parse(data);
}

export async function createAlert(
  kv: KVNamespace,
  userId: string,
  symbol: string,
  type: Alert["type"],
  value: number,
  message?: string
): Promise<Alert> {
  const alerts = await getAlerts(kv, userId);
  const alert: Alert = {
    id: crypto.randomUUID(),
    symbol: symbol.toUpperCase(),
    type,
    value,
    triggered: false,
    createdAt: new Date().toISOString(),
    message,
  };
  alerts.push(alert);
  await kv.put(`alerts:${userId}`, JSON.stringify(alerts));
  return alert;
}

export async function deleteAlert(kv: KVNamespace, userId: string, alertId: string): Promise<boolean> {
  const alerts = await getAlerts(kv, userId);
  const filtered = alerts.filter(a => a.id !== alertId);
  if (filtered.length === alerts.length) return false;
  await kv.put(`alerts:${userId}`, JSON.stringify(filtered));
  return true;
}

export async function checkAlerts(
  kv: KVNamespace,
  userId: string,
  currentPrices: Record<string, number>
): Promise<Alert[]> {
  const alerts = await getAlerts(kv, userId);
  const triggered: Alert[] = [];

  for (const alert of alerts) {
    if (alert.triggered) continue;
    const price = currentPrices[alert.symbol];
    if (!price) continue;

    let fire = false;
    if (alert.type === "PRICE_ABOVE" && price >= alert.value) fire = true;
    if (alert.type === "PRICE_BELOW" && price <= alert.value) fire = true;

    if (fire) {
      alert.triggered = true;
      alert.triggeredAt = new Date().toISOString();
      triggered.push(alert);
    }
  }

  if (triggered.length > 0) {
    await kv.put(`alerts:${userId}`, JSON.stringify(alerts));
  }

  return triggered;
}

// ─── Watchlist (per user) ─────────────────────────────

export async function getWatchlistSymbols(kv: KVNamespace, userId: string): Promise<string[]> {
  const data = await kv.get(`watchlist:${userId}`);
  if (!data) return DEFAULT_WATCHLIST;
  return JSON.parse(data);
}

export async function updateWatchlist(kv: KVNamespace, userId: string, symbols: string[]): Promise<string[]> {
  const clean = [...new Set(symbols.map(s => s.toUpperCase()))];
  await kv.put(`watchlist:${userId}`, JSON.stringify(clean));
  return clean;
}

export async function addToWatchlist(kv: KVNamespace, userId: string, symbol: string): Promise<string[]> {
  const current = await getWatchlistSymbols(kv, userId);
  const sym = symbol.toUpperCase();
  if (!current.includes(sym)) current.push(sym);
  await kv.put(`watchlist:${userId}`, JSON.stringify(current));
  return current;
}

export async function removeFromWatchlist(kv: KVNamespace, userId: string, symbol: string): Promise<string[]> {
  const current = await getWatchlistSymbols(kv, userId);
  const filtered = current.filter(s => s !== symbol.toUpperCase());
  await kv.put(`watchlist:${userId}`, JSON.stringify(filtered));
  return filtered;
}
