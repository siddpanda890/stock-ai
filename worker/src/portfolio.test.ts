import { describe, expect, it } from "vitest";
import { executeBuy, executeSell, getPortfolio } from "./portfolio";

class MemoryKV {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

describe("portfolio", () => {
  it("backfills initial capital and counts both buys and sells", async () => {
    const kv = new MemoryKV() as unknown as KVNamespace;

    const empty = await getPortfolio(kv, "user-1");
    expect(empty.initialCapital).toBe(100000);
    expect(empty.totalTradeCount).toBe(0);

    const buy = await executeBuy(kv, "user-1", "RELIANCE.NS", 10, 100);
    expect(buy.success).toBe(true);
    if (!buy.success) return;
    expect(buy.portfolio.totalTradeCount).toBe(1);
    expect(buy.portfolio.cash).toBe(99000);

    const sell = await executeSell(kv, "user-1", "RELIANCE.NS", 5, 120);
    expect(sell.success).toBe(true);
    if (!sell.success) return;
    expect(sell.portfolio.totalTradeCount).toBe(2);
    expect(sell.realizedPnl).toBe(100);
    expect(sell.portfolio.realizedPnl).toBe(100);
  });
});
