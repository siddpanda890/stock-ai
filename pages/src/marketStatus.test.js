import { describe, expect, it } from "vitest";
import { getMarketStatus } from "./marketStatus";

describe("getMarketStatus", () => {
  it("marks weekday trading hours as open", () => {
    const status = getMarketStatus(new Date("2026-04-20T04:15:00.000Z"));
    expect(status.isOpen).toBe(true);
    expect(status.isHoliday).toBe(false);
  });

  it("marks configured holidays as closed", () => {
    const status = getMarketStatus(new Date("2026-04-14T06:00:00.000Z"));
    expect(status.isOpen).toBe(false);
    expect(status.isHoliday).toBe(true);
    expect(status.holidayName).toBe("Dr. Ambedkar Jayanti");
  });
});
