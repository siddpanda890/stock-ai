// Vega Persistence Layer — Chat history, order book, AI analysis results
// Everything that was previously lost on refresh

// ═══════════════════════════════════════════════════════
// CHAT HISTORY
// ═══════════════════════════════════════════════════════

export interface ChatEntry {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  symbol?: string;
  model?: string;
}

const CHAT_KEY = (userId: string) => `persist:${userId}:chat`;

export async function saveChatHistory(
  kv: KVNamespace,
  userId: string,
  messages: ChatEntry[],
): Promise<void> {
  const trimmed = messages.slice(-200); // keep last 200 messages
  await kv.put(CHAT_KEY(userId), JSON.stringify(trimmed));
}

export async function getChatHistory(
  kv: KVNamespace,
  userId: string,
): Promise<ChatEntry[]> {
  const raw = await kv.get(CHAT_KEY(userId));
  return raw ? JSON.parse(raw) : [];
}

export async function appendChatMessage(
  kv: KVNamespace,
  userId: string,
  message: Omit<ChatEntry, "timestamp">,
): Promise<ChatEntry[]> {
  const history = await getChatHistory(kv, userId);
  const entry: ChatEntry = { ...message, timestamp: new Date().toISOString() };
  history.push(entry);
  const trimmed = history.slice(-200);
  await kv.put(CHAT_KEY(userId), JSON.stringify(trimmed));
  return trimmed;
}

export async function clearChatHistory(
  kv: KVNamespace,
  userId: string,
): Promise<void> {
  await kv.delete(CHAT_KEY(userId));
}

// ═══════════════════════════════════════════════════════
// ORDER BOOK
// ═══════════════════════════════════════════════════════

export interface OrderEntry {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT" | "STOP";
  quantity: number;
  price: number;
  triggerPrice?: number;
  status: "PENDING" | "FILLED" | "CANCELLED" | "EXPIRED";
  strategy: string;
  createdAt: string;
  filledAt?: string;
  notes?: string;
}

const ORDERS_KEY = (userId: string) => `persist:${userId}:orders`;

export async function saveOrders(
  kv: KVNamespace,
  userId: string,
  orders: OrderEntry[],
): Promise<void> {
  const trimmed = orders.slice(-500);
  await kv.put(ORDERS_KEY(userId), JSON.stringify(trimmed));
}

export async function getOrders(
  kv: KVNamespace,
  userId: string,
  limit: number = 100,
): Promise<OrderEntry[]> {
  const raw = await kv.get(ORDERS_KEY(userId));
  if (!raw) return [];
  const all: OrderEntry[] = JSON.parse(raw);
  return all.slice(0, limit);
}

export async function addOrder(
  kv: KVNamespace,
  userId: string,
  order: Omit<OrderEntry, "id" | "createdAt">,
): Promise<OrderEntry> {
  const entry: OrderEntry = {
    id: `ord_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    ...order,
  };
  const orders = await getOrders(kv, userId, 500);
  orders.unshift(entry);
  await kv.put(ORDERS_KEY(userId), JSON.stringify(orders.slice(0, 500)));
  return entry;
}

export async function updateOrderStatus(
  kv: KVNamespace,
  userId: string,
  orderId: string,
  status: OrderEntry["status"],
  filledAt?: string,
): Promise<OrderEntry | null> {
  const orders = await getOrders(kv, userId, 500);
  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx === -1) return null;
  orders[idx].status = status;
  if (filledAt) orders[idx].filledAt = filledAt;
  await kv.put(ORDERS_KEY(userId), JSON.stringify(orders));
  return orders[idx];
}

// ═══════════════════════════════════════════════════════
// AI ANALYSIS RESULTS
// ═══════════════════════════════════════════════════════

export interface SavedAnalysis {
  id: string;
  symbol: string;
  timestamp: string;
  model: string;
  signal: string;
  confidence: number;
  targetPrice: number;
  stopLoss: number;
  summary: string;
  technicalAnalysis: string;
  riskAssessment: string;
  catalysts: string[];
  timeHorizon: string;
  // Forward tracking fields
  priceAtAnalysis: number;
  priceAfter1d?: number;
  priceAfter3d?: number;
  priceAfter7d?: number;
  targetHit?: boolean;
  stopHit?: boolean;
  accuracyScore?: number;  // -1 to 1 based on direction + magnitude
}

const ANALYSIS_KEY = (userId: string) => `persist:${userId}:analyses`;

export async function saveAnalysisResult(
  kv: KVNamespace,
  userId: string,
  analysis: Omit<SavedAnalysis, "id" | "timestamp">,
): Promise<SavedAnalysis> {
  const entry: SavedAnalysis = {
    id: `anl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    ...analysis,
  };
  const existing = await getAnalysisHistory(kv, userId, 500);
  existing.unshift(entry);
  await kv.put(ANALYSIS_KEY(userId), JSON.stringify(existing.slice(0, 500)));
  return entry;
}

export async function getAnalysisHistory(
  kv: KVNamespace,
  userId: string,
  limit: number = 50,
): Promise<SavedAnalysis[]> {
  const raw = await kv.get(ANALYSIS_KEY(userId));
  if (!raw) return [];
  const all: SavedAnalysis[] = JSON.parse(raw);
  return all.slice(0, limit);
}

// Update analysis with forward price data (called by scheduled task or on-demand)
export async function updateAnalysisAccuracy(
  kv: KVNamespace,
  userId: string,
  analysisId: string,
  currentPrice: number,
  daysSinceAnalysis: number,
): Promise<SavedAnalysis | null> {
  const analyses = await getAnalysisHistory(kv, userId, 500);
  const idx = analyses.findIndex((a) => a.id === analysisId);
  if (idx === -1) return null;

  const a = analyses[idx];

  if (daysSinceAnalysis >= 1 && !a.priceAfter1d) a.priceAfter1d = currentPrice;
  if (daysSinceAnalysis >= 3 && !a.priceAfter3d) a.priceAfter3d = currentPrice;
  if (daysSinceAnalysis >= 7 && !a.priceAfter7d) a.priceAfter7d = currentPrice;

  // Check target/stop hit
  if (!a.targetHit && a.targetPrice > 0) {
    const bullish = a.signal.includes("BUY");
    if (bullish && currentPrice >= a.targetPrice) a.targetHit = true;
    if (!bullish && currentPrice <= a.targetPrice) a.targetHit = true;
  }
  if (!a.stopHit && a.stopLoss > 0) {
    const bullish = a.signal.includes("BUY");
    if (bullish && currentPrice <= a.stopLoss) a.stopHit = true;
    if (!bullish && currentPrice >= a.stopLoss) a.stopHit = true;
  }

  // Accuracy score: did price move in predicted direction?
  const priceChange = (currentPrice - a.priceAtAnalysis) / a.priceAtAnalysis;
  const predictedBullish = a.signal.includes("BUY");
  const actualBullish = priceChange > 0;
  const directionCorrect = predictedBullish === actualBullish;
  a.accuracyScore = directionCorrect ? Math.min(1, Math.abs(priceChange) * 10) : -Math.min(1, Math.abs(priceChange) * 10);

  analyses[idx] = a;
  await kv.put(ANALYSIS_KEY(userId), JSON.stringify(analyses));
  return a;
}

// Get overall signal accuracy stats
export async function getSignalAccuracyStats(
  kv: KVNamespace,
  userId: string,
): Promise<{
  totalAnalyses: number;
  withOutcomes: number;
  directionAccuracy: number;
  targetHitRate: number;
  stopHitRate: number;
  avgAccuracyScore: number;
}> {
  const analyses = await getAnalysisHistory(kv, userId, 500);
  const withOutcomes = analyses.filter((a) => a.accuracyScore !== undefined);
  const withTargets = analyses.filter((a) => a.targetHit !== undefined);
  const withStops = analyses.filter((a) => a.stopHit !== undefined);

  return {
    totalAnalyses: analyses.length,
    withOutcomes: withOutcomes.length,
    directionAccuracy: withOutcomes.length > 0
      ? (withOutcomes.filter((a) => (a.accuracyScore || 0) > 0).length / withOutcomes.length) * 100
      : 0,
    targetHitRate: withTargets.length > 0
      ? (withTargets.filter((a) => a.targetHit).length / withTargets.length) * 100
      : 0,
    stopHitRate: withStops.length > 0
      ? (withStops.filter((a) => a.stopHit).length / withStops.length) * 100
      : 0,
    avgAccuracyScore: withOutcomes.length > 0
      ? withOutcomes.reduce((s, a) => s + (a.accuracyScore || 0), 0) / withOutcomes.length
      : 0,
  };
}
