import { NSE_HOLIDAYS_2026 } from "./marketConfig";

export function getMarketStatus(now = new Date()) {
  const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const day = ist.getDay();
  const hh = ist.getHours();
  const mm = ist.getMinutes();
  const timeMin = hh * 60 + mm;
  const dateStr = `${ist.getFullYear()}-${String(ist.getMonth() + 1).padStart(2, "0")}-${String(ist.getDate()).padStart(2, "0")}`;

  const OPEN = 9 * 60 + 15;
  const CLOSE = 15 * 60 + 30;

  const isWeekday = day >= 1 && day <= 5;
  const holidayName = NSE_HOLIDAYS_2026[dateStr] || null;
  const isHoliday = Boolean(holidayName);
  const inHours = timeMin >= OPEN && timeMin < CLOSE;
  const isOpen = isWeekday && !isHoliday && inHours;

  let nextEvent = "";
  let minutesUntil = 0;

  if (isOpen) {
    minutesUntil = CLOSE - timeMin;
    const h = Math.floor(minutesUntil / 60);
    const m = minutesUntil % 60;
    nextEvent = `closes in ${h}h ${m}m`;
  } else if (isHoliday) {
    nextEvent = `Holiday - ${holidayName}`;
  } else if (!isWeekday) {
    nextEvent = day === 6 ? "Weekend - Saturday" : "Weekend - Sunday";
  } else if (timeMin < OPEN) {
    minutesUntil = OPEN - timeMin;
    const h = Math.floor(minutesUntil / 60);
    const m = minutesUntil % 60;
    nextEvent = `opens in ${h}h ${m}m`;
  } else {
    nextEvent = "closed for today";
  }

  return { isOpen, isWeekday, isHoliday, holidayName, inHours, nextEvent, dateStr, timeMin, OPEN, CLOSE };
}
