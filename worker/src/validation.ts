import { z } from "zod";
import type { Context } from "hono";

const symbolSchema = z.string().trim().min(1).max(32);
const positiveNumber = z.number().finite().positive();
const optionalNote = z.string().trim().max(500).optional();

export const registerSchema = z.object({
  username: z.string().trim().min(3).max(32),
  email: z.email(),
  password: z.string().min(6).max(128),
});

export const loginSchema = z.object({
  username: z.string().trim().min(3).max(32),
  password: z.string().min(6).max(128),
});

export const watchlistSchema = z.object({
  symbols: z.array(symbolSchema).min(1).max(100),
});

export const analyzeSchema = z.object({
  symbol: symbolSchema,
  model: z.string().trim().optional(),
});

export const chatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(20000),
  })).min(1).max(100),
  symbol: symbolSchema.optional(),
  model: z.string().trim().optional(),
});

export const scanSchema = z.object({
  symbol: symbolSchema,
});

export const backtestSchema = z.object({
  symbol: symbolSchema,
  strategy: z.enum(["bollinger-squeeze", "atr-expansion", "pump-dump", "all"]).optional(),
  initialCapital: positiveNumber.optional(),
  riskPerTrade: z.number().finite().positive().max(1).optional(),
  maxPositions: z.number().int().positive().max(100).optional(),
  commissionPerTrade: z.number().finite().min(0).optional(),
});

export const riskSizeSchema = z.object({
  entryPrice: positiveNumber,
  stopLoss: positiveNumber,
  portfolioValue: positiveNumber,
  winRate: z.number().finite().min(0).max(1).optional(),
  avgWinLoss: z.number().finite().positive().optional(),
  maxRiskPerTrade: z.number().finite().positive().max(1).optional(),
});

export const userSettingsSchema = z.object({
  defaultModel: z.string().trim().min(1).max(64).optional(),
  theme: z.enum(["dark", "light"]).optional(),
  alertsEnabled: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: "At least one setting is required" });

export const resetPortfolioSchema = z.object({
  cash: positiveNumber.optional(),
}).default({});

export const portfolioTradeSchema = z.object({
  symbol: symbolSchema,
  quantity: z.number().int().positive().max(1_000_000),
  price: positiveNumber,
  notes: optionalNote,
});

export const watchlistSymbolSchema = z.object({
  symbol: symbolSchema,
});

export const alertSchema = z.object({
  symbol: symbolSchema,
  type: z.enum(["PRICE_ABOVE", "PRICE_BELOW", "PERCENT_CHANGE"]),
  value: z.number().finite(),
  message: optionalNote,
});

export const signalSchema = z.object({
  symbol: symbolSchema,
  strategy: z.string().trim().min(1).max(64),
  signal: z.enum(["STRONG_BUY", "BUY", "HOLD", "SELL", "STRONG_SELL"]),
  confidence: z.number().finite().min(0).max(100).optional(),
  targetPrice: z.number().finite().optional(),
  stopLoss: z.number().finite().optional(),
  indicators: z.record(z.string(), z.number().finite()).optional(),
  reasoning: z.string().trim().max(5000).optional(),
  model: z.string().trim().max(64).optional(),
});

export const tradeLogSchema = z.object({
  symbol: symbolSchema,
  side: z.enum(["BUY", "SELL"]),
  quantity: z.number().int().positive().max(1_000_000),
  price: positiveNumber,
  signalId: z.string().trim().max(128).optional(),
  strategy: z.string().trim().max(64).optional(),
  notes: optionalNote,
});

export const closeTradeSchema = z.object({
  tradeId: z.string().trim().min(1).max(128),
  exitPrice: positiveNumber,
  notes: optionalNote,
});

export const riskCheckSchema = z.object({
  maxPositions: z.number().int().positive().max(100).optional(),
  dailyLossLimit: z.number().finite().positive().max(1).optional(),
  minConfidence: z.number().finite().min(0).max(100).optional(),
  portfolioValue: positiveNumber.optional(),
  signalConfidence: z.number().finite().min(0).max(100).optional(),
}).default({});

export const dynamicThresholdSchema = z.object({
  baseThreshold: z.number().finite().min(0).max(100).optional(),
}).default({});

export const chatHistorySchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(20000),
  symbol: symbolSchema.optional(),
  model: z.string().trim().max(64).optional(),
});

export const orderSchema = z.object({
  symbol: symbolSchema,
  side: z.enum(["BUY", "SELL"]),
  type: z.enum(["MARKET", "LIMIT", "STOP"]).optional(),
  quantity: z.number().int().positive().max(1_000_000),
  price: positiveNumber,
  triggerPrice: positiveNumber.optional(),
  strategy: z.string().trim().max(64).optional(),
  notes: optionalNote,
});

export const orderStatusSchema = z.object({
  status: z.enum(["PENDING", "FILLED", "CANCELLED", "EXPIRED"]),
});

export const analysisAccuracySchema = z.object({
  analysisId: z.string().trim().min(1).max(128),
  currentPrice: positiveNumber,
  daysSinceAnalysis: z.number().int().positive().max(365).optional(),
});

export async function readValidatedJson<T extends z.ZodTypeAny>(
  c: Context,
  schema: T,
): Promise<
  | { success: true; data: z.infer<T> }
  | { success: false; response: Response }
> {
  const body = await c.req.json().catch(() => undefined);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      success: false,
      response: c.json(
        { success: false, error: parsed.error.issues[0]?.message || "Invalid request body" },
        400,
      ),
    };
  }

  return { success: true, data: parsed.data };
}
