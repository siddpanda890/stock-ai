import { useEffect, useState } from "react";
import { getMarketStatus } from "./marketStatus";

export function useMarketStatus(intervalMs = 15000) {
  const [marketStatus, setMarketStatus] = useState(() => getMarketStatus());

  useEffect(() => {
    const id = setInterval(() => setMarketStatus(getMarketStatus()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return marketStatus;
}
