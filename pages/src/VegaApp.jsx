import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, ComposedChart
} from "recharts";
import { api } from "./api";
import { DEFAULT_SYMBOLS, INDEX_NAMES, INDEX_SYMBOLS } from "./marketConfig";
import { getMarketStatus } from "./marketStatus";
import { useMarketStatus } from "./useMarketStatus";

// ═══════════════════════════════════════════════════════════════
//  THEME SYSTEM
// ═══════════════════════════════════════════════════════════════
const FONT_MONO = "'IBM Plex Mono','JetBrains Mono','Fira Code',monospace";
const FONT_UI   = "'Inter','Segoe UI','Helvetica Neue',sans-serif";

const THEMES = {
  dark: {
    bg:"#090b0f", bg2:"#0d0f16", bg3:"#111420", bd:"#1a1f2e",
    tx:"#b8bfd0", mu:"#3a4055", g:"#00e87a", r:"#ff3d5a",
    a:"#ffab30", b:"#5b9ef7", pu:"#a78bfa",
    userMsg:"#0e1a2a", userMsgBd:"#1a3050",
    tooltipBg:"#0d0f16", tooltipBd:"#1a1f2e",
    scrollTrack:"#090b0f", scrollThumb:"#1a1f2e",
  },
  light: {
    bg:"#f4f5f7", bg2:"#ffffff", bg3:"#e8eaef", bd:"#d1d5db",
    tx:"#1f2937", mu:"#6b7280", g:"#059669", r:"#dc2626",
    a:"#d97706", b:"#2563eb", pu:"#7c3aed",
    userMsg:"#eff6ff", userMsgBd:"#bfdbfe",
    tooltipBg:"#ffffff", tooltipBd:"#d1d5db",
    scrollTrack:"#f4f5f7", scrollThumb:"#d1d5db",
  },
};
const ThemeCtx = createContext({ theme: "dark", toggle: () => {} });

// ═══════════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════════
const SMETA = {
  momentum:   { name:"Momentum",       color:"#00e87a", desc:"EMA 9/21 crossover + RSI"         },
  supertrend: { name:"SuperTrend",     color:"#ffab30", desc:"ATR flip signals"                  },
  mean_rev:   { name:"Mean Reversion", color:"#5b9ef7", desc:"Bollinger Band extremes"           },
  breakout:   { name:"Breakout",       color:"#f472b6", desc:"Volume + N20 high/low break"       },
  macd:       { name:"MACD",           color:"#a78bfa", desc:"MACD signal-line crossover"        },
};

// ═══════════════════════════════════════════════════════════════
//  MARKET HOURS (NSE/BSE: Mon-Fri 9:15 AM – 3:30 PM IST)
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
//  TECHNICAL INDICATORS
// ═══════════════════════════════════════════════════════════════
const TA = {
  ema(c, p) {
    if (c.length < p) return c.at(-1)??0;
    const k = 2/(p+1); let e = c.slice(0,p).reduce((a,b)=>a+b,0)/p;
    for (let i=p;i<c.length;i++) e = c[i]*k + e*(1-k); return e;
  },
  rsi(c, p=14) {
    if (c.length<p+1) return 50;
    let g=0,l=0;
    for (let i=c.length-p;i<c.length;i++){const d=c[i]-c[i-1]; d>0?g+=d:l-=d;}
    return 100-100/(1+g/(l||1e-6));
  },
  atr(candles, p=14) {
    if (candles.length<2) return candles[0] ? candles[0].close * 0.015 : 10;
    const trs=candles.slice(1).map((c,i)=>Math.max(c.high-c.low,Math.abs(c.high-candles[i].close),Math.abs(c.low-candles[i].close)));
    return trs.slice(-p).reduce((a,b)=>a+b,0)/Math.min(p,trs.length);
  },
  bollinger(c, p=20, m=2) {
    if (c.length<p) return {upper:c.at(-1)*1.02,middle:c.at(-1),lower:c.at(-1)*0.98};
    const sl=c.slice(-p), mid=sl.reduce((a,b)=>a+b,0)/p;
    const sd=Math.sqrt(sl.reduce((s,v)=>s+(v-mid)**2,0)/p);
    return {upper:mid+m*sd, middle:mid, lower:mid-m*sd};
  },
  macd(c) {
    if (c.length<26) return {macd:0,signal:0,hist:0};
    const mv = TA.ema(c,12)-TA.ema(c,26);
    const subs=c.slice(-9).map((_,i)=>{ const s=c.slice(0,c.length-8+i); return TA.ema(s,12)-TA.ema(s,26); });
    const sig=subs.reduce((a,b)=>a+b,0)/subs.length;
    return {macd:mv,signal:sig,hist:mv-sig};
  },
  supertrend(candles, p=10, m=3) {
    if (candles.length<p+2) return {trend:1,line:candles.at(-1)?.close??0,atr:0};
    const rc=candles.slice(-(p+5)); const a=TA.atr(rc,p);
    const last=rc.at(-1); const hl2=(last.high+last.low)/2;
    const upper=hl2+m*a, lower=hl2-m*a;
    const trend=last.close>lower?1:last.close<upper?-1:rc.at(-2)?.close>lower?1:-1;
    return {trend, line:trend===1?lower:upper, atr:a};
  },
  chandelier(candles, p=14, m=2.0) {
    const lastCandle = candles.at(-1);
    if (candles.length<p) return lastCandle ? lastCandle.close * 0.97 : 0;
    return Math.max(...candles.slice(-p).map(c=>c.high)) - m*TA.atr(candles,p);
  },
  vwap(candles) {
    let tv=0,v=0; candles.slice(-20).forEach(c=>{const tp=(c.high+c.low+c.close)/3; tv+=tp*c.volume; v+=c.volume;});
    return tv/(v||1);
  },
};

// ═══════════════════════════════════════════════════════════════
//  SIGNAL ENGINE
// ═══════════════════════════════════════════════════════════════
const SE = {
  momentum(stock) {
    const c=stock.candles.map(x=>x.close), p=stock;
    const e9=TA.ema(c,9),e21=TA.ema(c,21),e9p=TA.ema(c.slice(0,-1),9),e21p=TA.ema(c.slice(0,-1),21);
    const rsi=TA.rsi(c), price=c.at(-1), atr=TA.atr(p.candles);
    const crossUp=e9p<=e21p&&e9>e21, crossDn=e9p>=e21p&&e9<e21;
    if (crossUp&&rsi>45&&rsi<72) return {action:"BUY",  strength:Math.min(.95,(.72-rsi/100)+.55), reason:`EMA9↑EMA21 | RSI ${rsi.toFixed(0)}`, entry:price, sl:price-2*atr, target:price+3*atr};
    if (crossDn&&rsi<55&&rsi>28) return {action:"SELL", strength:Math.min(.95,(rsi/100-.28)+.55), reason:`EMA9↓EMA21 | RSI ${rsi.toFixed(0)}`, entry:price, sl:price+2*atr, target:price-3*atr};
    if (e9>e21&&rsi>55) return {action:"HOLD_LONG",strength:.35,reason:`Uptrend | spread ${(e9-e21).toFixed(1)}`,entry:price,sl:price-2*atr,target:price+3*atr};
    return {action:"NONE",strength:0,reason:`No cross | RSI ${rsi.toFixed(0)}`};
  },
  supertrend(stock) {
    const st=TA.supertrend(stock.candles,10,3), stP=TA.supertrend(stock.candles.slice(0,-1),10,3);
    const rsi=TA.rsi(stock.candles.map(c=>c.close)), price=stock.candles.at(-1).close, atr=st.atr||TA.atr(stock.candles);
    if (stP.trend===-1&&st.trend===1) return {action:"BUY",  strength:.88, reason:`ST flipped BULLISH | RSI ${rsi.toFixed(0)}`,entry:price,sl:st.line,target:price+3*atr};
    if (stP.trend===1 &&st.trend===-1) return {action:"SELL", strength:.88, reason:`ST flipped BEARISH | RSI ${rsi.toFixed(0)}`,entry:price,sl:st.line,target:price-3*atr};
    if (st.trend===1) return {action:"HOLD_LONG",strength:.3,reason:`ST bullish | line ₹${st.line.toFixed(0)}`,entry:price,sl:st.line,target:price+2*atr};
    return {action:"NONE",strength:0,reason:"ST bearish"};
  },
  mean_rev(stock) {
    const c=stock.candles.map(x=>x.close), bb=TA.bollinger(c), rsi=TA.rsi(c), price=c.at(-1), atr=TA.atr(stock.candles);
    if (price<=bb.lower*1.005&&rsi<35) return {action:"BUY",  strength:Math.min(.92,.6+(35-rsi)/100), reason:`Lower BB | RSI ${rsi.toFixed(0)} oversold`,entry:price,sl:price-1.5*atr,target:bb.middle};
    if (price>=bb.upper*.995&&rsi>65) return {action:"SELL", strength:Math.min(.92,.6+(rsi-65)/100), reason:`Upper BB | RSI ${rsi.toFixed(0)} overbought`,entry:price,sl:price+1.5*atr,target:bb.middle};
    return {action:"NONE",strength:0,reason:`BB%: ${Math.round(((price-bb.lower)/(bb.upper-bb.lower))*100)}%`};
  },
  breakout(stock) {
    const cv=stock.candles, price=cv.at(-1).close, vol=cv.at(-1).volume;
    const avgV=cv.slice(-20).reduce((s,c)=>s+c.volume,0)/20;
    const h20=Math.max(...cv.slice(-21,-1).map(c=>c.high)), l20=Math.min(...cv.slice(-21,-1).map(c=>c.low));
    const atr=TA.atr(cv), vs=vol>avgV*1.5;
    if (price>h20&&vs) return {action:"BUY",  strength:Math.min(.9,.65+(vol/avgV-1.5)*.15), reason:`20-bar break ↑ | vol ${(vol/avgV).toFixed(1)}x`,entry:price,sl:h20-atr,target:price+2.5*atr};
    if (price<l20&&vs) return {action:"SELL", strength:Math.min(.9,.65+(vol/avgV-1.5)*.15), reason:`20-bar break ↓ | vol ${(vol/avgV).toFixed(1)}x`,entry:price,sl:l20+atr,target:price-2.5*atr};
    return {action:"NONE",strength:0,reason:`Range: ${l20.toFixed(0)}–${h20.toFixed(0)}`};
  },
  macd(stock) {
    const c=stock.candles.map(x=>x.close), curr=TA.macd(c), prev=TA.macd(c.slice(0,-1));
    const rsi=TA.rsi(c), price=c.at(-1), atr=TA.atr(stock.candles);
    const bullX=prev.macd<=prev.signal&&curr.macd>curr.signal&&curr.macd<0;
    const bearX=prev.macd>=prev.signal&&curr.macd<curr.signal&&curr.macd>0;
    if (bullX&&rsi<65) return {action:"BUY",  strength:.82,reason:`MACD bull cross <0 | RSI ${rsi.toFixed(0)}`,entry:price,sl:price-2*atr,target:price+3*atr};
    if (bearX&&rsi>35) return {action:"SELL", strength:.82,reason:`MACD bear cross >0 | RSI ${rsi.toFixed(0)}`,entry:price,sl:price+2*atr,target:price-3*atr};
    return {action:"NONE",strength:0,reason:`hist:${curr.hist.toFixed(2)}`};
  },
};

// ═══════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════
function posSize(capital, riskPct, entry, sl) {
  const rAmt=capital*(riskPct/100), rPerShare=Math.abs(entry-sl);
  return Math.max(1, Math.floor(rAmt/(rPerShare||entry*.01)));
}
const fmt = {
  inr:n=>"₹"+Math.abs(n).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2}),
  usd:n=>"$"+Math.abs(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}),
  pct:n=>(n>=0?"+":"")+n.toFixed(2)+"%",
  num:n=>n.toLocaleString("en-IN"),
  t:()=>new Date().toLocaleTimeString("en-IN"),
};

// ═══════════════════════════════════════════════════════════════
//  APP
// ═══════════════════════════════════════════════════════════════
export default function VegaApp({ user, onLogout }) {
  // ── theme ────────────────────────────────────────────────────
  const [theme, setTheme] = useState(() => localStorage.getItem("vega-theme") || "dark");
  const toggleTheme = useCallback(() => {
    setTheme(prev => { const next = prev === "dark" ? "light" : "dark"; localStorage.setItem("vega-theme", next); return next; });
  }, []);
  // Sync body background with theme for scrollbar / overscroll areas
  useEffect(() => {
    const C = THEMES[theme];
    document.body.style.background = C.bg;
    document.body.style.color = C.tx;
    document.documentElement.style.background = C.bg;
  }, [theme]);

  // ── state ────────────────────────────────────────────────────
  const [market, setMarket] = useState({});
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketErrors, setMarketErrors] = useState([]);
  const [indexErrors, setIndexErrors] = useState([]);
  const [watchlistSymbols, setWatchlistSymbols] = useState(DEFAULT_SYMBOLS);
  const [indices,  setIndices]  = useState([]);
  // ── Positions: session-only (NOT in localStorage) ──
  // On page refresh, positions are lost. This is BY DESIGN:
  // Backend KV tracks holdings (permanent). Frontend positions are just the live
  // intra-session tracker for SL/target exits. Cash in backend already reflects
  // any buys, so no "phantom cash leak" is possible.
  const [positions,setPositions]= useState([]);
  const [orders,   setOrders]   = useState([]);
  const [tradeLog, setTradeLog] = useState(() => {
    try { return JSON.parse(localStorage.getItem("vega-tradeLog") || "[]"); } catch { return []; }
  });
  const [signals,  setSignals]  = useState([]);
  const [execLog,  setExecLog]  = useState([]);
  // Portfolio: backend KV is the SINGLE SOURCE OF TRUTH — never from localStorage
  const [portfolio,setPortfolio]= useState({capital:100000,cash:100000,peakCapital:100000,trades:0,wins:0});
  const [portfolioSynced, setPortfolioSynced] = useState(false);
  const [engine,   setEngine]   = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("vega-engine") || "null");
      // Restore engine SETTINGS but always start STOPPED
      // User must explicitly click START — prevents phantom auto-trading on refresh
      if (saved) return { ...saved, running: false };
    } catch {}
    return {
      running:false, autoSchedule:false, strategies:{momentum:true,supertrend:true,mean_rev:true,breakout:false,macd:false},
      riskPct:1.5, atrMult:2.0, maxPositions:5, minStrength:.70, dailyLossLimit:3.0, scanInterval:5, allowShort:false,
    };
  });
  // ── persist ONLY engine settings and trade log ──────────────────────────
  // Engine running=false is always saved (never persist running:true)
  // Positions and portfolio are NOT persisted — backend is truth
  useEffect(() => { localStorage.setItem("vega-engine", JSON.stringify({...engine, running: false})); }, [engine]);
  useEffect(() => { localStorage.setItem("vega-tradeLog", JSON.stringify(tradeLog)); }, [tradeLog]);

  const [tab,      setTab]      = useState("engine");
  const [selSym,   setSelSym]   = useState(DEFAULT_SYMBOLS[0]);
  const [settings, setSettings] = useState({growwToken:"",anthropicKey:"",paperMode:true});
  const [aiMsgs,   setAiMsgs]   = useState([{role:"assistant",content:"⚡ VEGA online.\n\n5 strategy engines ready: Momentum, SuperTrend, Mean Reversion, Breakout, MACD.\nDynamic ATR Chandelier stop-loss active.\n\nPress ▶ START ENGINE on the Auto Engine tab to begin automated trading.",ts:fmt.t()}]);
  const [aiInput,  setAiInput]  = useState("");
  const [aiLoading,setAiLoading]= useState(false);
  const [orderForm,setOrderForm]= useState({sym:DEFAULT_SYMBOLS[0],qty:"1",side:"BUY"});
  const [searchQ, setSearchQ]   = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimer = useRef(null);
  const aiEnd=useRef(null);
  const posRef=useRef(positions), mktRef=useRef(market), portRef=useRef(portfolio), engRef=useRef(engine);
  posRef.current=positions; mktRef.current=market; portRef.current=portfolio; engRef.current=engine;
  const marketStatus = useMarketStatus();

  // ── load market data on mount ──────────────────────────────────
  useEffect(() => {
    async function loadMarketData() {
      setMarketLoading(true);
      try {
        // Fetch quotes and history for each symbol
        const marketData = {};
        const results = await Promise.allSettled(
          watchlistSymbols.map(async (sym) => {
            try {
              const [quote, histData] = await Promise.all([
                api.getQuote(sym),
                api.getHistory(sym, "3mo")
              ]);
              // api.getHistory returns { history: [...], indicators: {...} }
              const history = histData?.history || histData;
              return { sym, quote, history };
            } catch (e) {
              console.error(`Failed to load ${sym}:`, e);
              return { sym, error: e instanceof Error ? e.message : "Failed to load market data" };
            }
          })
        );

        // Process results
        const failedSymbols = [];
        results.forEach((result) => {
          if (result.status === "fulfilled") {
            const { sym, quote, history, error } = result.value;
            if (error || !quote || !Array.isArray(history) || history.length === 0) {
              failedSymbols.push(sym);
              return;
            }
            let candles = [];
            let last = quote.price;
            let prevClose = quote.previousClose || quote.price;
            let change = quote.change || 0;
            let changePct = quote.changePercent || 0;

            // Convert history to candle format the TA module expects
            candles = history
              .filter(h => h.close > 0)
              .map(h => ({
                time: h.date || "",
                open: h.open || h.close,
                high: h.high || h.close,
                low: h.low || h.close,
                close: h.close,
                volume: h.volume || 10000
              }))
              .slice(-80);

            if (candles.length > 0) {
              const closes = candles.map(c => c.close);
              marketData[sym] = {
                sym,
                name: quote.name || sym.replace(".NS",""),
                basePrice: prevClose,
                sector: "NSE",
                candles,
                last,
                prevClose,
                change,
                changePct,
                rsi: TA.rsi(closes),
                atr: TA.atr(candles),
                vwap: TA.vwap(candles)
              };
            } else {
              failedSymbols.push(sym);
            }
          }
        });

        setMarket(marketData);
        setMarketErrors(failedSymbols);

        // Load indices
        const indicesResults = await Promise.allSettled(
          INDEX_SYMBOLS.map(sym => api.getQuote(sym))
        );
        const indicesData = [];
        const failedIndices = [];
        indicesResults.forEach((result, i) => {
          if (result.status === "fulfilled") {
            const quote = result.value;
            indicesData.push({
              name: INDEX_NAMES[INDEX_SYMBOLS[i]] || INDEX_SYMBOLS[i],
              symbol: INDEX_SYMBOLS[i],
              base: quote.previousClose || quote.price,
              current: quote.price,
              changePct: quote.changePercent || 0
            });
          } else {
            failedIndices.push(INDEX_SYMBOLS[i]);
          }
        });
        setIndices(indicesData);
        setIndexErrors(failedIndices);

        // Load portfolio from backend — backend KV is the SINGLE SOURCE OF TRUTH for cash
        try {
          const port = await api.getPortfolio();
          const backendCash = typeof port.cash === "number" ? port.cash : 100000;
          const portfolioVal = typeof port.portfolioValue === "number" ? port.portfolioValue : backendCash;
          setPortfolio({
            cash: backendCash,
            capital: portfolioVal,
            peakCapital: Math.max(portfolioVal, 100000),
            trades: port.totalTradeCount || 0,
            wins: port.winCount || 0,
          });
          setPortfolioSynced(true); // Allow engine to trade now
        } catch (e) {
          console.warn("Failed to load portfolio:", e);
          // Do NOT ungate engine if backend failed — trading with fake 100k is dangerous
          // User can still manually start engine, but auto-start won't happen
        }

      } catch (e) {
        console.error("Market load error:", e);
      } finally {
        setMarketLoading(false);
      }
    }

    loadMarketData();
  }, [watchlistSymbols]);

  useEffect(() => {
    const availableSymbols = Object.keys(market);
    if (!availableSymbols.length) return;

    if (!market[selSym]) {
      setSelSym(availableSymbols[0]);
    }

    setOrderForm((prev) => (market[prev.sym] ? prev : { ...prev, sym: availableSymbols[0] }));
  }, [market, selSym]);

  // ── market tick (fetch quotes every 30 seconds) ─────────────────
  useEffect(() => {
    const fetchQuotes = async () => {
      const symbols = Object.keys(market);
      if (!symbols.length) return;

      const quotes = await Promise.allSettled(symbols.map(s => api.getQuote(s)));
      setMarket(prev => {
        const next = { ...prev };
        quotes.forEach((q, i) => {
          if (q.status === "fulfilled") {
            const sym = symbols[i];
            const quote = q.value;
            const st = prev[sym];
            if (st) {
              const newCandle = {
                time: new Date().toLocaleTimeString("en-IN"),
                open: quote.open || quote.price,
                high: quote.high || quote.price,
                low: quote.low || quote.price,
                close: quote.price,
                volume: quote.volume || 10000
              };
              const candles = [...st.candles.slice(-99), newCandle];
              const closes = candles.map(c => c.close);
              next[sym] = {
                ...st,
                candles,
                last: quote.price,
                change: quote.change || 0,
                changePct: quote.changePercent || 0,
                rsi: TA.rsi(closes),
                atr: TA.atr(candles),
                vwap: TA.vwap(candles)
              };
            }
          }
        });
        return next;
      });
    };

    const id = setInterval(fetchQuotes, 30000);
    return () => clearInterval(id);
  }, [Object.keys(market).join(",")]);

  // ── update positions ──────────────────────────────────────────
  useEffect(()=>{
    setPositions(prev=>prev.map(p=>{
      const st=market[p.sym]; if(!st) return p;
      const newSL=TA.chandelier(st.candles,14,engine.atrMult);
      const sl=p.side==="LONG"?Math.max(p.sl,newSL):p.sl;
      return {...p,ltp:st.last,sl,pnl:(st.last-p.entryPrice)*p.qty*(p.side==="LONG"?1:-1)};
    }));
  },[market]);

  // Derive P&L from positions — computed values, not stored in portfolio state
  const dayPnL = positions.reduce((s,p)=>s+p.pnl,0);
  const invested = positions.reduce((s,p)=>s+p.entryPrice*p.qty,0);
  const currentValue = portfolio.cash + invested + dayPnL;

  useEffect(()=>{
    // Only update peakCapital when currentValue actually exceeds previous peak
    if(currentValue > portfolio.peakCapital){
      setPortfolio(prev=>({...prev,peakCapital:currentValue}));
    }
  },[currentValue]);

  // ── execution helpers ─────────────────────────────────────────
  const addLog=useCallback((msg,type="info")=>{
    setExecLog(prev=>[{id:Date.now()+Math.random(),msg,type,ts:fmt.t()},...prev.slice(0,299)]);
  },[]);

  // Re-sync portfolio from backend after trades to keep cash accurate
  const syncPortfolioFromBackend=useCallback(()=>{
    api.getPortfolio().then(port=>{
      const backendCash = typeof port.cash === "number" ? port.cash : 100000;
      const portfolioVal = typeof port.portfolioValue === "number" ? port.portfolioValue : backendCash;
      setPortfolio({
        cash: backendCash,
        capital: portfolioVal,
        peakCapital: Math.max(portfolioVal, 100000),
        trades: port.totalTradeCount || 0,
        wins: port.winCount || 0,
      });
    }).catch(()=>{});
  },[]);

  const closePos=useCallback((p,exitPrice,reason)=>{
    const pnl=(exitPrice-p.entryPrice)*p.qty*(p.side==="LONG"?1:-1);
    setPositions(prev=>prev.filter(x=>x.id!==p.id));
    setTradeLog(prev=>[{id:Date.now(),sym:p.sym,side:p.side,qty:p.qty,entryPrice:p.entryPrice,exitPrice,pnl,reason,ts:fmt.t()},...prev.slice(0,299)]);
    // Optimistic cash update for immediate UI feedback
    setPortfolio(prev=>({...prev,cash:prev.cash+exitPrice*p.qty,trades:prev.trades+1,wins:prev.wins+(pnl>0?1:0)}));
    const icon=reason==="SL_HIT"?"🛑":reason==="TARGET"?"🎯":"📤";
    addLog(`${icon} EXIT ${p.sym} @ ${fmt.inr(exitPrice)} | P&L:${pnl>=0?"+":""}${fmt.inr(pnl)} [${reason}]`,pnl>=0?"profit":"loss");

    // Sync to backend THEN re-read backend cash to correct any drift
    api.sell(p.sym, p.qty, exitPrice, `${reason} | ${p.side}`)
      .then(()=>syncPortfolioFromBackend())
      .catch(e => {
        addLog(`⚠️ Backend sell failed: ${e.message}`, "loss");
        syncPortfolioFromBackend(); // Re-sync even on failure to correct frontend
      });
  },[addLog,syncPortfolioFromBackend]);

  const openPos=useCallback((sym,side,entry,sl,target,strategy,qty,reason)=>{
    const pos={id:Date.now()+Math.random(),sym,side,qty,entryPrice:entry,sl,target,strategy,ltp:entry,pnl:0,entryTs:Date.now(),entryTime:fmt.t()};
    setPositions(prev=>[...prev,pos]);
    // Optimistic cash deduction for immediate UI feedback
    setPortfolio(prev=>({...prev,cash:prev.cash-entry*qty}));
    setOrders(prev=>[{id:`${settings.paperMode?"P":"L"}-${Date.now()}`,sym,side:side==="LONG"?"BUY":"SELL",qty,price:entry.toFixed(2),status:"FILLED",strategy,ts:fmt.t()},...prev.slice(0,299)]);
    addLog(`📈 ENTER ${side} ${sym} @ ${fmt.inr(entry)} | Qty:${qty} | SL:${fmt.inr(sl)} | T:${fmt.inr(target)} [${strategy}] ${reason}`,"buy");

    // Sync to backend THEN re-read backend cash to correct any drift
    api.buy(sym, qty, entry, `${strategy} | ${reason}`)
      .then(()=>syncPortfolioFromBackend())
      .catch(e => {
        addLog(`⚠️ Backend buy failed: ${e.message}`, "loss");
        syncPortfolioFromBackend(); // Re-sync to correct frontend cash
      });
  },[settings,addLog,syncPortfolioFromBackend]);

  // ── SCAN ENGINE ───────────────────────────────────────────────
  const runScan=useCallback(()=>{
    const mkt=mktRef.current, pos=posRef.current, port=portRef.current, eng=engRef.current;

    // 1. SL / Target / Exit-signal check
    const toClose=[];
    pos.forEach(p=>{
      const st=mkt[p.sym]; if(!st) return;
      const ltp=st.last;
      if(p.side==="LONG"  && ltp<=p.sl)     {toClose.push({p,ltp,reason:"SL_HIT"});return;}
      if(p.side==="SHORT" && ltp>=p.sl)     {toClose.push({p,ltp,reason:"SL_HIT"});return;}
      if(p.side==="LONG"  && ltp>=p.target) {toClose.push({p,ltp,reason:"TARGET"});return;}
      if(p.side==="SHORT" && ltp<=p.target) {toClose.push({p,ltp,reason:"TARGET"});return;}
      // strategy exit
      Object.entries(eng.strategies).forEach(([id,on])=>{
        if(!on||!SE[id]) return;
        const sig=SE[id](st);
        if(p.side==="LONG"  && sig.action==="SELL" && sig.strength>=.75) toClose.push({p,ltp,reason:`EXIT:${id}`});
        if(p.side==="SHORT" && sig.action==="BUY"  && sig.strength>=.75) toClose.push({p,ltp,reason:`EXIT:${id}`});
      });
    });
    // deduplicate closes
    const closedIds=new Set();
    toClose.forEach(({p,ltp,reason})=>{if(!closedIds.has(p.id)){closedIds.add(p.id);closePos({...p,ltp},ltp,reason);}});

    // 2. Daily loss halt (only check if trades have been made)
    // Derive from positions (dayPnL and invested are no longer in portfolio state)
    const posDayPnL=pos.reduce((s,p)=>s+p.pnl,0);
    const posInvested=pos.reduce((s,p)=>s+p.entryPrice*p.qty,0);
    const currentVal=port.cash+posInvested+posDayPnL;
    const dd=port.peakCapital>0&&port.trades>0?Math.max(0,((port.peakCapital-currentVal)/port.peakCapital)*100):0;
    if(dd>=eng.dailyLossLimit){setEngine(e=>({...e,running:false}));addLog(`⛔ Daily loss limit ${eng.dailyLossLimit}% hit (DD: ${dd.toFixed(1)}%). Engine halted.`,"loss");return;}

    // 3. Scan for entries
    const alive=pos.filter(p=>!closedIds.has(p.id));
    if(alive.length>=eng.maxPositions) return;

    // Track cash spent THIS scan cycle to prevent over-allocation
    let availCash=port.cash;
    const liveSigs=[];
    Object.keys(mkt).forEach(sym=>{
      const st=mkt[sym]; if(!st) return;
      if(alive.find(p=>p.sym===sym)) return;
      Object.entries(eng.strategies).forEach(([id,on])=>{
        if(!on||!SE[id]) return;
        const sig=SE[id](st);
        if(sig.action!=="NONE") liveSigs.push({sym,strategy:id,...sig,ltp:st.last,ts:fmt.t()});
        if((sig.action==="BUY"||(sig.action==="SELL"&&eng.allowShort))&&sig.strength>=eng.minStrength){
          if(alive.length>=eng.maxPositions) return;
          const side=sig.action==="BUY"?"LONG":"SHORT";
          const qty=posSize(availCash,eng.riskPct,sig.entry,sig.sl);
          const cost=sig.entry*qty;
          if(cost>availCash*.9||qty<1) return;
          availCash-=cost; // Deduct from local tracker so next position sees reduced cash
          alive.push({sym,id:Date.now(),side});
          openPos(sym,side,sig.entry,sig.sl,sig.target,id,qty,sig.reason);
        }
      });
    });
    setSignals(liveSigs.filter(s=>s.action!=="NONE"&&s.action!=="HOLD_LONG").sort((a,b)=>b.strength-a.strength).slice(0,25));
  },[closePos,openPos,addLog]);

  // ── engine timer (waits for market data before scanning) ──────
  const timerRef=useRef(null);
  const engineStartedRef=useRef(false);
  useEffect(()=>{
    clearInterval(timerRef.current);
    if(!engine.running) { engineStartedRef.current=false; return; }
    // Don't start scanning until market data AND portfolio are loaded from backend
    if(marketLoading || Object.keys(market).length===0) return;
    if(!portfolioSynced) return; // Wait for backend cash to load before trading
    if(!engineStartedRef.current) {
      addLog("⚡ Auto-trade engine STARTED","info");
      engineStartedRef.current=true;
    }
    runScan();
    timerRef.current=setInterval(runScan,engine.scanInterval*1000);
    return ()=>clearInterval(timerRef.current);
  },[engine.running,engine.scanInterval,runScan,marketLoading,Object.keys(market).length,portfolioSynced]);

  // ── Auto start/stop based on NSE market hours ──────────────
  // Use refs so the interval callback always sees fresh state without re-creating
  const engineRunningRef = useRef(engine.running);
  engineRunningRef.current = engine.running;
  const wasOpenRef = useRef(null); // tracks previous market state to detect transitions
  useEffect(() => {
    if (!engine.autoSchedule) { wasOpenRef.current = null; return; }
    function checkMarketHours() {
      const { isOpen } = getMarketStatus();
      const wasOpen = wasOpenRef.current;
      const running = engineRunningRef.current;
      wasOpenRef.current = isOpen;

      // First check — just record state, don't act (avoids flicker on page load)
      if (wasOpen === null) {
        // On first load with autoSchedule ON: start if market is open
        if (isOpen && !running) {
          setEngine(e => ({ ...e, running: true }));
          addLog("🕘 Auto-START: market is open (9:15–15:30 IST)", "info");
        }
        return;
      }

      // Transition: market just opened → auto-start
      if (isOpen && !wasOpen && !running) {
        setEngine(e => ({ ...e, running: true }));
        addLog("🕘 Auto-START: market just opened", "info");
      }
      // Transition: market just closed → auto-stop
      if (!isOpen && wasOpen && running) {
        setEngine(e => ({ ...e, running: false }));
        addLog("🕞 Auto-STOP: market just closed", "info");
      }
    }
    checkMarketHours();
    const id = setInterval(checkMarketHours, 30000);
    return () => clearInterval(id);
  }, [engine.autoSchedule, addLog]); // engine.running intentionally excluded — read via ref

  // ── Market status for display ──────────────────────────────

  // ── AI ────────────────────────────────────────────────────────
  async function sendAI(msg){
    if(!msg.trim()) return;
    setAiMsgs(prev=>[...prev,{role:"user",content:msg,ts:fmt.t()}]);
    setAiInput(""); setAiLoading(true);
    const port=portRef.current, pos=posRef.current;
    const aiDayPnL=pos.reduce((s,p)=>s+(p.pnl||0),0);
    const contextMsg = `[VEGA Context] Portfolio: Cash ₹${fmt.num(Math.round(port.cash))} | P&L ₹${fmt.inr(aiDayPnL)} | Win rate: ${port.trades?Math.round(port.wins/port.trades*100):0}%
Positions: ${pos.map(p=>`${p.sym} ${p.side} ${p.qty}@₹${p.entryPrice.toFixed(0)} SL:₹${p.sl?.toFixed(0)} P&L:${fmt.inr(p.pnl||0)}`).join(" | ")||"none"}
Signals: ${signals.slice(0,5).map(s=>`${s.sym} ${s.action}(${(s.strength*100).toFixed(0)}%) via ${s.strategy}`).join(" | ")||"none"}
User asks: ${msg}`;
    try{
      const chatMsgs = [...aiMsgs.slice(-6).map(m=>({role:m.role,content:m.content})),{role:"user",content:contextMsg}];
      const data = await api.chat(chatMsgs, selSym, aiModel);
      setAiMsgs(prev=>[...prev,{role:"assistant",content:data.response||"No response received.",ts:fmt.t()}]);
    }catch(e){
      setAiMsgs(prev=>[...prev,{role:"assistant",content:`⚠️ AI Error: ${e.message}. Check backend connection.`,ts:fmt.t()}]);
    }
    setAiLoading(false);
  }
  useEffect(()=>{aiEnd.current?.scrollIntoView({behavior:"smooth"});},[aiMsgs]);

  // ── stock search ──────────────────────────────────────────────
  function handleSearch(q) {
    setSearchQ(q);
    clearTimeout(searchTimer.current);
    if (!q.trim()) { setSearchResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const results = await api.search(q);
        setSearchResults(results.slice(0, 8));
      } catch { setSearchResults([]); }
      setSearchLoading(false);
    }, 400);
  }
  async function addSymbol(sym) {
    if (watchlistSymbols.includes(sym) || market[sym]) return;
    setSearchQ(""); setSearchResults([]);
    setWatchlistSymbols(prev => [...prev, sym]);
    try { await api.addToWatchlist(sym); } catch {}
  }

  // ── manual order ──────────────────────────────────────────────
  function submitOrder(e,forceSide){
    e.preventDefault();
    const side=forceSide||orderForm.side;
    const st=market[orderForm.sym], price=st?.last||0, qty=Math.max(1,parseInt(orderForm.qty)||1);
    if (!st || price <= 0) {
      addLog(`Market data unavailable for ${orderForm.sym}. Order skipped.`, "loss");
      return;
    }
    const atr=st?.atr||price*.01;
    if(side==="BUY"){
      openPos(orderForm.sym,"LONG",price,price-engine.atrMult*atr,price+engine.atrMult*1.5*atr,"manual",qty,"Manual BUY");
    } else {
      const pos=positions.find(p=>p.sym===orderForm.sym);
      if(pos) closePos({...pos,ltp:price},price,"MANUAL_EXIT");
    }
  }

  // ── chart data ────────────────────────────────────────────────
  const availableSymbols = Object.keys(market);
  const activeSymbol = market[selSym] ? selSym : availableSymbols[0];
  const selSt = activeSymbol ? market[activeSymbol] : null;
  const chartPts=selSt?.candles.slice(-50).map(c=>({t:c.time.slice(0,5),p:+c.close.toFixed(2),v:c.volume}))||[];
  const selPos=positions.find(p=>p.sym===activeSymbol);
  // currentValue is already computed above as a derived value
  const drawdown=portfolio.peakCapital>0&&portfolio.trades>0?Math.max(0,((portfolio.peakCapital-currentValue)/portfolio.peakCapital)*100):0;
  const winRate=portfolio.trades>0?(portfolio.wins/portfolio.trades*100).toFixed(0):"—";

  // ── colours (theme-driven) ────────────────────────────────────
  const C = THEMES[theme];
  const S={
    app:{background:C.bg,color:C.tx,minHeight:"100vh",display:"flex",flexDirection:"column",fontFamily:FONT_MONO,fontSize:"13px",transition:"background .25s,color .25s"},
    topbar:{background:C.bg2,borderBottom:`1px solid ${C.bd}`,padding:"10px 18px",display:"flex",alignItems:"center",gap:0},
    logo:{color:C.g,fontWeight:700,fontSize:"20px",letterSpacing:"4px",marginRight:"24px",fontFamily:FONT_UI},
    nav:{background:C.bg2,borderBottom:`1px solid ${C.bd}`,padding:"0 18px",display:"flex"},
    nb:a=>({padding:"11px 18px",background:"none",border:"none",borderBottom:a?`2px solid ${C.g}`:"2px solid transparent",color:a?C.g:C.mu,cursor:"pointer",fontSize:"12px",letterSpacing:"1.5px",textTransform:"uppercase",fontFamily:FONT_UI,fontWeight:500,transition:"color .15s"}),
    body:{flex:1,padding:"12px",display:"flex",gap:"12px",overflow:"hidden"},
    card:{background:C.bg2,border:`1px solid ${C.bd}`,borderRadius:"8px",padding:"14px 16px",transition:"background .25s,border-color .25s"},
    ct:{color:C.mu,fontSize:"10px",letterSpacing:"2px",textTransform:"uppercase",marginBottom:"10px",borderBottom:`1px solid ${C.bg3}`,paddingBottom:"6px",fontFamily:FONT_UI,fontWeight:600},
    inp:{background:C.bg3,border:`1px solid ${C.bd}`,borderRadius:"6px",padding:"9px 12px",color:C.tx,fontSize:"13px",fontFamily:FONT_MONO,width:"100%",boxSizing:"border-box",outline:"none",transition:"border-color .2s"},
    sel:{background:C.bg3,border:`1px solid ${C.bd}`,borderRadius:"6px",padding:"9px 12px",color:C.tx,fontSize:"13px",fontFamily:FONT_MONO,width:"100%",outline:"none"},
    btn:(col,fill)=>({background:fill?col+"22":"transparent",border:`1px solid ${col}`,borderRadius:"6px",color:col,padding:"8px 14px",cursor:"pointer",fontSize:"11px",fontFamily:FONT_UI,fontWeight:600,letterSpacing:"1px",transition:"all .15s"}),
    bdg:col=>({background:col+"18",border:`1px solid ${col}44`,borderRadius:"4px",color:col,padding:"3px 8px",fontSize:"10px",display:"inline-block",fontFamily:FONT_UI,fontWeight:600}),
    row:(alt)=>({display:"grid",padding:"7px 8px",borderBottom:`1px solid ${C.bg3}`,alignItems:"center",background:alt?C.bg3+"66":"transparent"}),
    dot:col=>({width:7,height:7,borderRadius:"50%",background:col,display:"inline-block",marginRight:6,boxShadow:`0 0 6px ${col}`}),
  };

  // ════════════════════════════════════════════════════════════════
  //  ENGINE TAB
  // ════════════════════════════════════════════════════════════════
  const EngineTab=()=>(
    <div style={{flex:1,display:"flex",flexDirection:"column",gap:"10px",overflow:"auto"}}>
      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:"8px"}}>
        {[
          {l:"PORTFOLIO VALUE",v:fmt.inr(currentValue),c:C.tx},
          {l:"DAY P&L",v:(dayPnL>=0?"+":"")+fmt.inr(dayPnL),c:dayPnL>=0?C.g:C.r},
          {l:"FREE CASH",v:fmt.inr(portfolio.cash),c:C.a},
          {l:"WIN RATE",v:winRate+(portfolio.trades?"%":""),c:C.b},
          {l:"DRAWDOWN",v:"-"+drawdown.toFixed(2)+"%",c:drawdown>2?C.r:C.mu},
        ].map(k=>(
          <div key={k.l} style={S.card}>
            <div style={{fontSize:"10px",color:C.mu,letterSpacing:"1.5px",marginBottom:"6px",fontFamily:FONT_UI,fontWeight:500}}>{k.l}</div>
            <div style={{fontSize:"22px",fontWeight:700,color:k.c,fontFamily:FONT_UI,letterSpacing:"-0.5px"}}>{k.v}</div>
          </div>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"250px 1fr 1fr",gap:"10px",flex:1,minHeight:0}}>
        {/* Controls column */}
        <div style={{display:"flex",flexDirection:"column",gap:"10px",overflow:"auto"}}>
          {/* Big toggle */}
          <div style={S.card}>
            <div style={S.ct}>AUTO-TRADE ENGINE</div>
            <div onClick={()=>setEngine(e=>({...e,running:!e.running}))}
              style={{border:`2px solid ${engine.running?C.r:C.g}`,borderRadius:"8px",padding:"18px",textAlign:"center",cursor:"pointer",background:engine.running?C.r+"12":C.g+"10",marginBottom:"12px",transition:"all .2s"}}>
              <div style={{fontSize:"22px",color:engine.running?C.r:C.g,letterSpacing:"4px",fontWeight:700,fontFamily:FONT_UI}}>{engine.running?"⛔  STOP":"▶  START"}</div>
              <div style={{fontSize:"11px",color:C.mu,marginTop:"5px",fontFamily:FONT_UI}}>{engine.running?"scanning all stocks…":"idle — click to start"}</div>
            </div>
            <div style={{fontSize:"12px",color:C.mu,lineHeight:2.0,fontFamily:FONT_UI}}>
              <div style={{display:"flex",justifyContent:"space-between"}}><span>Status</span><span style={{color:engine.running?C.g:C.mu}}><span style={S.dot(engine.running?C.g:C.mu)}/>{engine.running?"ACTIVE":"IDLE"}</span></div>
              <div style={{display:"flex",justifyContent:"space-between"}}><span>Positions</span><span style={{color:C.tx,fontWeight:600}}>{positions.length}/{engine.maxPositions}</span></div>
              <div style={{display:"flex",justifyContent:"space-between"}}><span>Signals found</span><span style={{color:C.a,fontWeight:600}}>{signals.length}</span></div>
              <div style={{display:"flex",justifyContent:"space-between"}}><span>Scan every</span><span style={{color:C.b,fontWeight:600}}>{engine.scanInterval}s</span></div>
              <div style={{display:"flex",justifyContent:"space-between"}}><span>Mode</span><span style={S.bdg(settings.paperMode?C.a:C.r)}>{settings.paperMode?"PAPER":"LIVE"}</span></div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><span>Auto Schedule</span>
                <div onClick={()=>setEngine(e=>({...e,autoSchedule:!e.autoSchedule}))}
                  style={{width:34,height:18,borderRadius:9,background:engine.autoSchedule?C.g:C.mu,cursor:"pointer",position:"relative",transition:"background .2s"}}>
                  <div style={{position:"absolute",top:2,left:engine.autoSchedule?18:2,width:14,height:14,borderRadius:7,background:"#fff",transition:"left .2s"}}/>
                </div>
              </div>
              {engine.autoSchedule && <div style={{background:marketStatus.isOpen?C.g+"15":C.r+"15",border:`1px solid ${marketStatus.isOpen?C.g+"30":C.r+"30"}`,borderRadius:4,padding:"6px 8px",marginTop:4}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:"10px",color:C.mu}}>NSE</span>
                  <span style={{fontSize:"10px",color:marketStatus.isOpen?C.g:C.r,fontWeight:600}}>{marketStatus.isOpen?"OPEN":"CLOSED"}</span>
                </div>
                <div style={{fontSize:"9px",color:C.mu,marginTop:2}}>{marketStatus.nextEvent} • 9:15–15:30 IST</div>
              </div>}
            </div>
          </div>

          {/* Strategy toggles */}
          <div style={S.card}>
            <div style={S.ct}>STRATEGIES</div>
            {Object.entries(SMETA).map(([id,meta])=>(
              <div key={id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.bg3}`}}>
                <div>
                  <div style={{color:engine.strategies[id]?meta.color:C.mu,fontSize:"13px",fontWeight:600,fontFamily:FONT_UI}}>{meta.name}</div>
                  <div style={{color:C.mu,fontSize:"10px",fontFamily:FONT_UI,marginTop:2}}>{meta.desc}</div>
                </div>
                <div onClick={()=>setEngine(e=>({...e,strategies:{...e.strategies,[id]:!e.strategies[id]}}))}
                  style={{width:32,height:16,background:engine.strategies[id]?meta.color+"33":C.bg3,border:`1px solid ${engine.strategies[id]?meta.color:C.bd}`,borderRadius:8,cursor:"pointer",position:"relative",flexShrink:0,transition:"all .2s"}}>
                  <div style={{position:"absolute",top:2,left:engine.strategies[id]?16:2,width:10,height:10,borderRadius:"50%",background:engine.strategies[id]?meta.color:C.mu,transition:"left .2s"}}/>
                </div>
              </div>
            ))}
          </div>

          {/* Risk sliders */}
          <div style={S.card}>
            <div style={S.ct}>RISK PARAMETERS</div>
            {[
              {k:"riskPct",      l:"Risk / Trade",     s:"%",  min:.5, max:5,  step:.5,  sc:1 },
              {k:"atrMult",      l:"ATR SL Multiplier",s:"×",  min:1,  max:4,  step:.5,  sc:1 },
              {k:"minStrength",  l:"Min Signal Conf",  s:"%",  min:50, max:95, step:5,   sc:100},
              {k:"maxPositions", l:"Max Positions",    s:"",   min:1,  max:10, step:1,   sc:1 },
              {k:"dailyLossLimit",l:"Daily Loss Halt", s:"%",  min:1,  max:10, step:.5,  sc:1 },
              {k:"scanInterval", l:"Scan Interval",    s:"s",  min:3,  max:60, step:1,   sc:1 },
            ].map(p=>(
              <div key={p.k} style={{marginBottom:"10px"}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:"11px",marginBottom:"3px",fontFamily:FONT_UI}}>
                  <span style={{color:C.mu}}>{p.l}</span>
                  <span style={{color:C.a,fontWeight:600}}>{(engine[p.k]*(p.sc||1)).toFixed(p.step<1?1:0)}{p.s}</span>
                </div>
                <input type="range" min={p.min} max={p.max} step={p.step}
                  value={engine[p.k]*(p.sc||1)}
                  onChange={e=>setEngine(prev=>({...prev,[p.k]:parseFloat(e.target.value)/(p.sc||1)}))}
                  style={{width:"100%",accentColor:C.a,height:"3px"}}/>
              </div>
            ))}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:"6px"}}>
              <span style={{color:C.mu,fontSize:"9px"}}>Allow Short Selling</span>
              <div onClick={()=>setEngine(e=>({...e,allowShort:!e.allowShort}))}
                style={{width:32,height:16,background:engine.allowShort?C.g+"33":C.bg3,border:`1px solid ${engine.allowShort?C.g:C.bd}`,borderRadius:8,cursor:"pointer",position:"relative"}}>
                <div style={{position:"absolute",top:2,left:engine.allowShort?16:2,width:10,height:10,borderRadius:"50%",background:engine.allowShort?C.g:C.mu,transition:"left .2s"}}/>
              </div>
            </div>
          </div>
        </div>

        {/* Signal feed */}
        <div style={{...S.card,display:"flex",flexDirection:"column",overflow:"hidden"}}>
          <div style={S.ct}>LIVE SIGNAL FEED — {signals.length} signals</div>
          <div style={{overflow:"auto",flex:1}}>
            <div style={{...S.row(false),gridTemplateColumns:"80px 80px 58px 60px 75px 75px auto",color:C.mu,fontSize:"10px",letterSpacing:"1px",position:"sticky",top:0,background:C.bg2,zIndex:1,fontFamily:FONT_UI,fontWeight:600}}>
              {["SYMBOL","STRATEGY","ACTION","CONF","ENTRY","SL","REASON"].map(h=><span key={h}>{h}</span>)}
            </div>
            {signals.length===0&&<div style={{color:C.mu,textAlign:"center",padding:"40px 0",fontSize:"13px",fontFamily:FONT_UI}}>{engine.running?"Scanning…":"Start the engine"}</div>}
            {signals.map((s,i)=>{
              const meta=SMETA[s.strategy], isBuy=s.action==="BUY"||s.action==="HOLD_LONG";
              return (
                <div key={i} onClick={()=>{setSelSym(s.sym);setTab("positions");}}
                  style={{...S.row(i%2===0),gridTemplateColumns:"80px 80px 58px 60px 75px 75px auto",fontSize:"12px",cursor:"pointer"}}>
                  <span style={{color:C.tx,fontWeight:700}}>{s.sym}</span>
                  <span style={S.bdg(meta?.color||C.mu)}>{s.strategy}</span>
                  <span style={{color:isBuy?C.g:C.r,fontWeight:700,fontSize:"11px"}}>{s.action}</span>
                  <div>
                    <div style={{width:`${Math.round(s.strength*100)}%`,height:3,background:s.strength>.8?C.g:C.a,borderRadius:2}}/>
                    <div style={{color:s.strength>.8?C.g:C.a,fontSize:"9px"}}>{(s.strength*100).toFixed(0)}%</div>
                  </div>
                  <span style={{fontSize:"9px"}}>{s.entry?fmt.inr(s.entry):"—"}</span>
                  <span style={{fontSize:"9px",color:C.r}}>{s.sl?fmt.inr(s.sl):"—"}</span>
                  <span style={{color:C.mu,fontSize:"9px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.reason}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Exec log */}
        <div style={{...S.card,display:"flex",flexDirection:"column",overflow:"hidden"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div style={S.ct}>EXECUTION LOG</div>
            <button onClick={()=>setExecLog([])} style={{...S.btn(C.mu),padding:"2px 7px",fontSize:"9px"}}>CLEAR</button>
          </div>
          <div style={{overflow:"auto",flex:1,fontFamily:"monospace",fontSize:"9px",lineHeight:1.7}}>
            {execLog.length===0&&<div style={{color:C.mu,padding:"30px",textAlign:"center"}}>No executions yet</div>}
            {execLog.map(e=>(
              <div key={e.id} style={{padding:"3px 4px",borderBottom:`1px solid ${C.bg3}`,
                color:e.type==="buy"?C.g:e.type==="profit"?C.b:e.type==="loss"?C.r:C.mu}}>
                <span style={{color:C.mu,marginRight:5}}>{e.ts}</span>{e.msg}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  // ════════════════════════════════════════════════════════════════
  //  POSITIONS TAB
  // ════════════════════════════════════════════════════════════════
  const PositionsTab=()=>(
    <div style={{flex:1,display:"grid",gridTemplateColumns:"1.4fr 1fr",gap:"10px",overflow:"hidden"}}>
      <div style={{display:"flex",flexDirection:"column",gap:"10px",overflow:"hidden"}}>
        {/* Price chart */}
        <div style={S.card}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
            <div style={{...S.ct,marginBottom:0}}>{selSym} — {selSt?fmt.inr(selSt.last):"—"}{selSt&&<span style={{color:selSt.changePct>=0?C.g:C.r,marginLeft:8}}>{fmt.pct(selSt.changePct)}</span>}</div>
            <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
              {Object.keys(market).slice(0,7).map(s=><button key={s} onClick={()=>setSelSym(s)} style={{...S.btn(selSym===s?C.g:C.bd),padding:"2px 6px",fontSize:"9px"}}>{(market[s]?.name||s).slice(0,6)}</button>)}
              <div style={{position:"relative"}}>
                <input value={searchQ} onChange={e=>handleSearch(e.target.value)} placeholder="Search…" style={{...S.inp,width:100,padding:"2px 6px",fontSize:"9px"}}/>
                {searchResults.length>0&&<div style={{position:"absolute",top:"100%",right:0,zIndex:10,background:C.bg2,border:`1px solid ${C.bd}`,borderRadius:6,padding:4,minWidth:200,maxHeight:200,overflow:"auto",boxShadow:"0 8px 24px rgba(0,0,0,.4)"}}>
                  {searchResults.map(r=>(
                    <div key={r.symbol} onClick={()=>{addSymbol(r.symbol);setSelSym(r.symbol);}} style={{padding:"5px 8px",cursor:"pointer",fontSize:"10px",borderBottom:`1px solid ${C.bg3}`,display:"flex",justifyContent:"space-between"}}>
                      <span style={{color:C.g,fontWeight:700}}>{r.symbol}</span>
                      <span style={{color:C.mu,fontSize:"9px",maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.name}</span>
                    </div>
                  ))}
                </div>}
              </div>
            </div>
          </div>
          {selSt&&<div style={{display:"flex",gap:12,marginBottom:5,fontSize:"9px",color:C.mu}}>
            <span>RSI:<span style={{color:selSt.rsi<35?C.g:selSt.rsi>65?C.r:C.a}}> {selSt.rsi.toFixed(1)}</span></span>
            <span>ATR:<span style={{color:C.b}}> {selSt.atr.toFixed(2)}</span></span>
            <span>VWAP:<span style={{color:C.pu}}> {fmt.inr(selSt.vwap)}</span></span>
            <span>Vol:<span style={{color:C.mu}}> {fmt.num(selSt.candles.at(-1)?.volume||0)}</span></span>
          </div>}
          <div style={{height:165}}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartPts} margin={{top:4,right:0,left:0,bottom:0}}>
                <defs>
                  <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={C.g} stopOpacity={.12}/>
                    <stop offset="95%" stopColor={C.g} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="t" tick={{fill:C.mu,fontSize:8}} tickLine={false} axisLine={false} interval={8}/>
                <YAxis domain={["auto","auto"]} tick={{fill:C.mu,fontSize:8}} tickLine={false} axisLine={false} tickFormatter={v=>"₹"+v.toFixed(0)} width={54}/>
                <Tooltip contentStyle={{background:C.tooltipBg,border:`1px solid ${C.tooltipBd}`,fontSize:10,borderRadius:3,color:C.tx}} formatter={v=>[fmt.inr(v),"Price"]}/>
                {selPos&&<ReferenceLine y={selPos.sl}          stroke={C.r}  strokeDasharray="3 2" label={{value:"SL",fill:C.r,fontSize:8}}/>}
                {selPos&&<ReferenceLine y={selPos.target}      stroke={C.b}  strokeDasharray="3 2" label={{value:"T", fill:C.b,fontSize:8}}/>}
                {selPos&&<ReferenceLine y={selPos.entryPrice}  stroke={C.a}  strokeDasharray="3 2" label={{value:"E", fill:C.a,fontSize:8}}/>}
                <Area type="monotone" dataKey="p" stroke={C.g} strokeWidth={1.5} fill="url(#pg)" dot={false}/>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div style={{height:38,marginTop:2}}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartPts} margin={{top:0,right:0,left:0,bottom:0}}>
                <Bar dataKey="v" fill={C.bg3}/><XAxis hide/><YAxis hide/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Trade history */}
        <div style={{...S.card,flex:1,overflow:"hidden"}}>
          <div style={S.ct}>COMPLETED TRADES ({tradeLog.length})</div>
          <div style={{overflow:"auto"}}>
            <div style={{...S.row(false),gridTemplateColumns:"68px 52px 42px 72px 72px 75px 70px 60px",color:C.mu,fontSize:"8px",letterSpacing:"1px"}}>
              {["SYMBOL","SIDE","QTY","ENTRY","EXIT","P&L","REASON","TIME"].map(h=><span key={h}>{h}</span>)}
            </div>
            {tradeLog.length===0&&<div style={{color:C.mu,padding:"16px",textAlign:"center"}}>No completed trades</div>}
            {tradeLog.map(t=>(
              <div key={t.id} style={{...S.row(false),gridTemplateColumns:"68px 52px 42px 72px 72px 75px 70px 60px",fontSize:"10px"}}>
                <span style={{color:C.tx,fontWeight:700}}>{t.sym}</span>
                <span style={{color:t.side==="LONG"?C.g:C.r}}>{t.side}</span>
                <span>{t.qty}</span>
                <span>{fmt.inr(t.entryPrice)}</span>
                <span>{fmt.inr(t.exitPrice)}</span>
                <span style={{color:t.pnl>=0?C.g:C.r,fontWeight:700}}>{t.pnl>=0?"+":""}{fmt.inr(t.pnl)}</span>
                <span style={S.bdg(t.reason==="SL_HIT"?C.r:t.reason==="TARGET"?C.g:C.a)}>{(t.reason||"").replace("EXIT_SIGNAL:","").replace("MANUAL_EXIT","MAN")}</span>
                <span style={{color:C.mu,fontSize:"9px"}}>{t.ts}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:"10px",overflow:"hidden"}}>
        {/* Open positions */}
        <div style={{...S.card,flex:1,overflow:"hidden"}}>
          <div style={S.ct}>OPEN POSITIONS ({positions.length}/{engine.maxPositions})</div>
          <div style={{overflow:"auto"}}>
            {positions.length===0&&<div style={{color:C.mu,textAlign:"center",padding:"40px 6px",fontSize:"11px"}}>No open positions.<br/>Start the engine to begin auto-trading.</div>}
            {positions.map(p=>{
              const pnlPct=((p.ltp-p.entryPrice)/p.entryPrice)*100*(p.side==="LONG"?1:-1);
              const slDist=Math.abs((p.ltp-p.sl)/p.ltp*100);
              const slBar=Math.min(100,Math.max(0,100-slDist*10));
              const meta=SMETA[p.strategy];
              return (
                <div key={p.id} style={{padding:"8px 4px",borderBottom:`1px solid ${C.bg3}`,cursor:"pointer"}} onClick={()=>setSelSym(p.sym)}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                    <span style={{color:C.tx,fontWeight:700}}>{p.sym}<span style={{color:C.mu,fontSize:"9px",marginLeft:5}}>{p.side}</span></span>
                    <span style={{color:p.pnl>=0?C.g:C.r,fontWeight:700}}>{p.pnl>=0?"+":""}{fmt.inr(p.pnl)}</span>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",color:C.mu,fontSize:"10px",marginBottom:4}}>
                    <span>{p.qty} × {fmt.inr(p.entryPrice)} → {fmt.inr(p.ltp)}</span>
                    <span style={{color:p.pnl>=0?C.g:C.r}}>{fmt.pct(pnlPct)}</span>
                  </div>
                  {/* ATR Chandelier SL bar */}
                  <div style={{display:"flex",gap:4,alignItems:"center",marginBottom:3}}>
                    <span style={{color:C.mu,fontSize:"8px",width:14}}>SL</span>
                    <div style={{flex:1,background:C.bg3,borderRadius:2,height:3}}>
                      <div style={{width:slBar+"%",background:slDist<1.5?C.r:slDist<3?C.a:C.g,height:"100%",borderRadius:2,transition:"width .6s"}}/>
                    </div>
                    <span style={{color:C.r,fontSize:"8px",minWidth:55,textAlign:"right"}}>{fmt.inr(p.sl)}</span>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:"8px",color:C.mu,marginBottom:4}}>
                    <span>Target <span style={{color:C.b}}>{fmt.inr(p.target)}</span></span>
                    <span style={S.bdg(meta?.color||C.mu)}>{p.strategy}</span>
                  </div>
                  <button onClick={ev=>{ev.stopPropagation();closePos({...p,ltp:market[p.sym]?.last||p.ltp},market[p.sym]?.last||p.ltp,"MANUAL_EXIT");}}
                    style={{...S.btn(C.r),padding:"3px 8px",fontSize:"9px"}}>EXIT NOW</button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Manual order */}
        <div style={S.card}>
          <div style={S.ct}>MANUAL ORDER</div>
          <form onSubmit={e=>submitOrder(e,orderForm.side)}>
            <div style={{marginBottom:8}}>
              <div style={{color:C.mu,fontSize:"8px",marginBottom:3}}>SYMBOL</div>
              <select value={orderForm.sym} onChange={e=>setOrderForm(p=>({...p,sym:e.target.value}))} style={S.sel}>
                {Object.keys(market).map(s=><option key={s}>{s}</option>)}
              </select>
            </div>
            <div style={{marginBottom:8}}>
              <div style={{color:C.mu,fontSize:"8px",marginBottom:3}}>QUANTITY</div>
              <input type="number" value={orderForm.qty} onChange={e=>setOrderForm(p=>({...p,qty:e.target.value}))} style={S.inp}/>
            </div>
            <div style={{background:C.bg3,borderRadius:3,padding:"6px 8px",marginBottom:8,fontSize:"9px",color:C.mu,lineHeight:1.8}}>
              <div>LTP: <span style={{color:C.tx}}>{fmt.inr(market[orderForm.sym]?.last||0)}</span></div>
              <div>Est. SL (ATR×{engine.atrMult}): <span style={{color:C.r}}>{fmt.inr((market[orderForm.sym]?.last||0)-engine.atrMult*(market[orderForm.sym]?.atr||0))}</span></div>
              <div>Order value: <span style={{color:C.a}}>{fmt.inr((market[orderForm.sym]?.last||0)*parseInt(orderForm.qty||0))}</span></div>
            </div>
            <div style={{display:"flex",gap:6}}>
              <button type="submit" onClick={()=>setOrderForm(p=>({...p,side:"BUY"}))} style={{flex:1,...S.btn(C.g,true),padding:"9px"}}>▲ BUY</button>
              <button type="submit" onClick={()=>setOrderForm(p=>({...p,side:"SELL"}))} style={{flex:1,...S.btn(C.r,true),padding:"9px"}}>▼ SELL</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );

  // ════════════════════════════════════════════════════════════════
  //  SCANNER TAB
  // ════════════════════════════════════════════════════════════════
  const ScannerTab=()=>{
    const rows=Object.values(market).map(s=>{
      const st=s; if(!st) return null;
      const closes=st.candles.map(c=>c.close), bb=TA.bollinger(closes), st2=TA.supertrend(st.candles), mc=TA.macd(closes);
      const pctB=Math.round(((st.last-bb.lower)/(bb.upper-bb.lower))*100);
      const allS=Object.entries(SE).map(([id,fn])=>({id,...fn(st)}));
      const topS=allS.filter(s=>s.action==="BUY"||s.action==="SELL").sort((a,b)=>b.strength-a.strength)[0];
      const rr=topS&&topS.sl&&topS.target?Math.abs((topS.target-topS.entry)/(topS.entry-topS.sl)).toFixed(1):"—";
      const inPos=!!positions.find(p=>p.sym===s.sym);
      return {sym:s.sym,last:st.last,changePct:st.changePct,rsi:st.rsi,atr:st.atr,pctB,st2,mc,topS,rr,inPos};
    }).filter(Boolean).sort((a,b)=>(b.topS?.strength||0)-(a.topS?.strength||0));
    return (
      <div style={{flex:1,overflow:"auto"}}>
        <div style={S.card}>
          <div style={S.ct}>MARKET SCANNER — ALL STRATEGIES × ALL STOCKS (real-time)</div>
          <div style={{...S.row(false),gridTemplateColumns:"80px 68px 52px 48px 52px 48px 55px 52px 48px 75px 88px auto",color:C.mu,fontSize:"8px",letterSpacing:"1px",position:"sticky",top:0,background:C.bg2,zIndex:1}}>
            {["SYMBOL","LTP","CHG%","RSI","ATR","BB%","ST","MACD","R:R","STRATEGY","ACTION","REASON"].map(h=><span key={h}>{h}</span>)}
          </div>
          {rows.map((r,i)=>{
            const meta=r.topS?SMETA[r.topS.id]:null;
            return (
              <div key={r.sym} onClick={()=>{setSelSym(r.sym);setTab("positions");}}
                style={{...S.row(i%2===0),gridTemplateColumns:"80px 68px 52px 48px 52px 48px 55px 52px 48px 75px 88px auto",fontSize:"10px",cursor:"pointer",background:r.inPos?C.g+"08":i%2===0?C.bg3+"66":"transparent"}}>
                <span style={{color:C.tx,fontWeight:700}}>{r.sym}{r.inPos?" ●":""}</span>
                <span style={{color:r.changePct>=0?C.g:C.r}}>{fmt.inr(r.last)}</span>
                <span style={{color:r.changePct>=0?C.g:C.r}}>{fmt.pct(r.changePct)}</span>
                <span style={{color:r.rsi<35?C.g:r.rsi>65?C.r:C.a}}>{r.rsi.toFixed(0)}</span>
                <span style={{color:C.b}}>{r.atr.toFixed(1)}</span>
                <span style={{color:r.pctB<20?C.g:r.pctB>80?C.r:C.mu}}>{r.pctB}%</span>
                <span style={{color:r.st2.trend===1?C.g:C.r,fontSize:"9px"}}>{r.st2.trend===1?"↑BULL":"↓BEAR"}</span>
                <span style={{color:r.mc.hist>0?C.g:C.r,fontSize:"9px"}}>{r.mc.hist.toFixed(1)}</span>
                <span style={{color:r.rr!=="—"&&parseFloat(r.rr)>=2?C.g:C.mu}}>{r.rr!=="—"?r.rr+"x":"—"}</span>
                {r.topS?<span style={S.bdg(meta?.color||C.mu)}>{r.topS.id}</span>:<span style={{color:C.mu}}>—</span>}
                {r.topS?<span style={{color:r.topS.action==="BUY"?C.g:C.r,fontWeight:700}}>{(r.topS.strength*100).toFixed(0)}% {r.topS.action}</span>:<span style={{color:C.mu}}>no signal</span>}
                <span style={{color:C.mu,fontSize:"9px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.topS?.reason||"—"}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ── AI analysis ─────────────────────────────────────────────
  const [aiModel, setAiModel] = useState("sonnet-4.6");
  const [analysis, setAnalysis] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisHistory, setAnalysisHistory] = useState([]);

  async function runAnalysis(sym) {
    setAnalysisLoading(true);
    try {
      const result = await api.analyze(sym || selSym, aiModel);
      setAnalysis(result);
      setAnalysisHistory(prev => [{...result, ts: fmt.t()}, ...prev.slice(0, 19)]);
      // Also add to chat as context
      const a = result.analysis;
      setAiMsgs(prev => [...prev, {role:"assistant", content:`📊 AI Analysis — ${result.quote.symbol}\n\nSignal: ${a.signal} (${a.confidence}% confidence)\nTarget: ₹${a.targetPrice?.toFixed(2)} | SL: ₹${a.stopLoss?.toFixed(2)}\nTime: ${a.timeHorizon}\n\n${a.summary}\n\n🔬 Technical: ${a.technicalAnalysis?.slice(0,200)}…\n⚠️ Risk: ${a.riskAssessment?.slice(0,150)}…\n\n📌 Catalysts: ${(a.catalysts||[]).join(", ")}\n\n⚖️ ${result.disclaimer}`, ts:fmt.t()}]);
    } catch (e) {
      setAiMsgs(prev => [...prev, {role:"assistant", content:`⚠️ Analysis failed: ${e.message}`, ts:fmt.t()}]);
    }
    setAnalysisLoading(false);
  }

  // ── autonomous AI agent: auto-analyze strong signals ──────────
  const autoAnalyzedRef = useRef(new Set());
  useEffect(() => {
    if (!engine.running || analysisLoading || signals.length === 0) return;
    // Find strong signals (>85%) not yet auto-analyzed this session
    const strong = signals.find(s => s.strength >= 0.85 && !autoAnalyzedRef.current.has(s.sym + s.action));
    if (strong) {
      autoAnalyzedRef.current.add(strong.sym + strong.action);
      addLog(`🤖 Auto-analyzing ${strong.sym} (${(strong.strength*100).toFixed(0)}% ${strong.action} via ${strong.strategy})`, "info");
      runAnalysis(strong.sym);
    }
  }, [signals, engine.running, analysisLoading]);

  // ── news sentiment agent: fetch news for selected symbol ──────
  const [newsData, setNewsData] = useState([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const lastNewsFetch = useRef("");
  async function fetchNews(sym) {
    const target = sym || selSym;
    if (newsLoading || lastNewsFetch.current === target) return;
    lastNewsFetch.current = target;
    setNewsLoading(true);
    try {
      const news = await api.getNews(target);
      setNewsData(news?.slice(0, 10) || []);
    } catch { setNewsData([]); }
    setNewsLoading(false);
  }
  // Auto-fetch news when selected symbol changes
  useEffect(() => { if (tab === "ai") fetchNews(); }, [selSym, tab]);

  // ════════════════════════════════════════════════════════════════
  //  AI TAB
  // ════════════════════════════════════════════════════════════════
  const AITab=()=>{
    const sigColor = !analysis ? C.mu : analysis.analysis?.signal?.includes("BUY") ? C.g : analysis.analysis?.signal?.includes("SELL") ? C.r : C.a;
    return (
    <div style={{flex:1,display:"grid",gridTemplateColumns:"1fr 300px",gap:"10px",overflow:"hidden"}}>
      <div style={{...S.card,display:"flex",flexDirection:"column"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div style={S.ct}>VEGA AI — TRADING INTELLIGENCE</div>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <select value={aiModel} onChange={e=>setAiModel(e.target.value)} style={{...S.sel,width:"auto",padding:"3px 8px",fontSize:"9px"}}>
              <optgroup label="Claude (Anthropic)">
                <option value="sonnet-4.6">Claude Sonnet 4.6</option>
                <option value="opus-4.6">Claude Opus 4.6</option>
                <option value="haiku-4.5">Claude Haiku 4.5</option>
              </optgroup>
              <optgroup label="Gemini (Google)">
                <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
              </optgroup>
              <optgroup label="GPT (Azure OpenAI)">
                <option value="gpt-5.4-pro">GPT-5.4 Pro</option>
                <option value="gpt-5.4">GPT-5.4</option>
                <option value="o4-mini">o4-mini (Reasoning)</option>
                <option value="gpt-4.1">GPT-4.1</option>
              </optgroup>
            </select>
            <span style={S.bdg(C.pu)}>{aiModel.includes("gemini")?"GEMINI":aiModel.includes("gpt")||aiModel==="o4-mini"?"GPT":aiModel.split("-")[0].toUpperCase()}</span>
          </div>
        </div>
        <div style={{flex:1,overflow:"auto",marginBottom:8}}>
          {aiMsgs.map((m,i)=>(
            <div key={i} style={{padding:"8px",borderRadius:3,marginBottom:6,background:m.role==="user"?C.userMsg:C.bg3,border:`1px solid ${m.role==="user"?C.userMsgBd:C.bd}`}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                <span style={{color:m.role==="user"?C.b:C.g,fontSize:"9px",fontWeight:700}}>{m.role==="user"?"YOU":"⚡ VEGA"}</span>
                <span style={{color:C.mu,fontSize:"9px"}}>{m.ts}</span>
              </div>
              <div style={{color:C.tx,whiteSpace:"pre-wrap",lineHeight:1.65,fontSize:"11px"}}>{m.content}</div>
            </div>
          ))}
          {(aiLoading||analysisLoading)&&<div style={{...S.card,color:C.mu,fontSize:"11px",animation:"pulse 1s infinite"}}>⚡ VEGA {analysisLoading?"running deep analysis":"thinking"}…</div>}
          <div ref={aiEnd}/>
        </div>
        <div style={{display:"flex",gap:6,marginBottom:6}}>
          <input value={aiInput} onChange={e=>setAiInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&sendAI(aiInput)} placeholder="Ask VEGA about strategy, positions, market conditions…" style={{...S.inp,flex:1}}/>
          <button onClick={()=>sendAI(aiInput)} disabled={aiLoading||analysisLoading} style={S.btn(C.g,true)}>SEND</button>
        </div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          {["Best setups right now","Review my stop-losses","Market regime today","Strongest strategy today","Any positions to exit?","Portfolio risk assessment"].map(q=>(
            <button key={q} onClick={()=>sendAI(q)} style={{...S.btn(C.mu),padding:"3px 7px",fontSize:"9px"}}>{q}</button>
          ))}
        </div>
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:"10px",overflow:"auto"}}>
        {/* AI Deep Analysis */}
        <div style={S.card}>
          <div style={S.ct}>AI DEEP ANALYSIS</div>
          <div style={{display:"flex",gap:6,marginBottom:8}}>
            <select value={selSym} onChange={e=>setSelSym(e.target.value)} style={{...S.sel,flex:1,padding:"5px 8px",fontSize:"10px"}}>
              {Object.keys(market).map(s=><option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={()=>runAnalysis()} disabled={analysisLoading} style={{...S.btn(C.pu,true),padding:"5px 10px",fontSize:"10px",whiteSpace:"nowrap"}}>
              {analysisLoading?"Analyzing…":"🔬 ANALYZE"}
            </button>
          </div>
          {analysis?.analysis && (
            <div style={{fontSize:"10px",lineHeight:1.8}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                <span style={{color:sigColor,fontWeight:700,fontSize:"14px"}}>{analysis.analysis.signal}</span>
                <span style={{color:C.a,fontWeight:700}}>{analysis.analysis.confidence}%</span>
              </div>
              <div style={{padding:"6px 8px",background:C.bg3,borderRadius:3,marginBottom:6}}>
                <div style={{color:C.tx,fontWeight:600,marginBottom:3}}>{analysis.analysis.summary}</div>
                <div style={{color:C.mu,fontSize:"9px"}}>Target: <span style={{color:C.g}}>₹{analysis.analysis.targetPrice?.toFixed(2)}</span> | SL: <span style={{color:C.r}}>₹{analysis.analysis.stopLoss?.toFixed(2)}</span></div>
                <div style={{color:C.mu,fontSize:"9px"}}>Horizon: <span style={{color:C.b}}>{analysis.analysis.timeHorizon}</span> | Model: <span style={{color:C.pu}}>{analysis.analysis.model}</span></div>
              </div>
              {analysis.analysis.catalysts?.length > 0 && (
                <div style={{marginBottom:6}}>
                  <div style={{color:C.mu,fontSize:"9px",marginBottom:2}}>CATALYSTS:</div>
                  {analysis.analysis.catalysts.map((c,i)=>(
                    <div key={i} style={{color:C.tx,fontSize:"9px",paddingLeft:8}}>• {c}</div>
                  ))}
                </div>
              )}
            </div>
          )}
          {!analysis && <div style={{color:C.mu,fontSize:"10px",textAlign:"center",padding:"12px 0"}}>Select a stock and click Analyze for AI-powered deep analysis</div>}
        </div>

        {/* Market Pulse */}
        <div style={S.card}>
          <div style={S.ct}>MARKET PULSE</div>
          {Object.values(market).slice(0,8).map(s=>(
            <div key={s.sym} onClick={()=>setSelSym(s.sym)} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:`1px solid ${C.bg3}`,fontSize:"10px",cursor:"pointer"}}>
              <span style={{color:C.tx}}>{(s.name||s.sym).slice(0,12)}</span>
              <div style={{textAlign:"right"}}>
                <div style={{color:s.changePct>=0?C.g:C.r}}>{fmt.pct(s.changePct)}</div>
                <div style={{color:C.mu,fontSize:"8px"}}>RSI {s.rsi.toFixed(0)}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Top Signals */}
        <div style={S.card}>
          <div style={S.ct}>TOP SIGNALS</div>
          {signals.slice(0,5).map((s,i)=>{const meta=SMETA[s.strategy]; return (
            <div key={i} style={{padding:"4px 0",borderBottom:`1px solid ${C.bg3}`,cursor:"pointer"}} onClick={()=>{setSelSym(s.sym);runAnalysis(s.sym);}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:"10px"}}>
                <span style={{color:C.tx,fontWeight:700}}>{s.sym}</span>
                <span style={{color:s.action==="BUY"?C.g:C.r,fontWeight:700}}>{s.action}</span>
              </div>
              <div style={{color:C.mu,fontSize:"8px"}}>{meta?.name} · {(s.strength*100).toFixed(0)}% · click to analyze</div>
            </div>
          );})}
          {signals.length===0&&<div style={{color:C.mu,fontSize:"10px"}}>Start engine to generate signals</div>}
        </div>

        {/* Analysis History */}
        {analysisHistory.length > 0 && (
          <div style={S.card}>
            <div style={S.ct}>ANALYSIS LOG ({analysisHistory.length})</div>
            {analysisHistory.slice(0,5).map((a,i)=>{
              const sig=a.analysis; const sc=sig?.signal?.includes("BUY")?C.g:sig?.signal?.includes("SELL")?C.r:C.a;
              return (
                <div key={i} style={{padding:"4px 0",borderBottom:`1px solid ${C.bg3}`,fontSize:"9px"}}>
                  <div style={{display:"flex",justifyContent:"space-between"}}>
                    <span style={{color:C.tx,fontWeight:600}}>{a.quote?.symbol}</span>
                    <span style={{color:sc,fontWeight:700}}>{sig?.signal} {sig?.confidence}%</span>
                  </div>
                  <div style={{color:C.mu}}>{a.ts} · {sig?.model} · T:₹{sig?.targetPrice?.toFixed(0)}</div>
                </div>
              );
            })}
          </div>
        )}

        {/* News Sentiment */}
        <div style={S.card}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={S.ct}>NEWS — {selSym}</div>
            <button onClick={()=>{lastNewsFetch.current="";fetchNews();}} style={{...S.btn(C.b),padding:"2px 6px",fontSize:"8px"}}>{newsLoading?"…":"REFRESH"}</button>
          </div>
          {newsData.length>0 ? newsData.slice(0,5).map((n,i)=>(
            <div key={i} style={{padding:"4px 0",borderBottom:`1px solid ${C.bg3}`,fontSize:"9px"}}>
              <a href={n.link||n.url||"#"} target="_blank" rel="noopener" style={{color:C.b,textDecoration:"none",lineHeight:1.4,display:"block"}}>{(n.title||"News").slice(0,60)}{(n.title||"").length>60?"…":""}</a>
              <div style={{color:C.mu,fontSize:"8px",marginTop:1}}>{n.publisher||n.source||""} · {n.providerPublishTime ? new Date(n.providerPublishTime*1000).toLocaleDateString("en-IN") : ""}</div>
            </div>
          )) : <div style={{color:C.mu,fontSize:"10px",textAlign:"center",padding:"8px 0"}}>{newsLoading?"Loading news…":"No news available"}</div>}
        </div>
      </div>
    </div>
  );};

  // ════════════════════════════════════════════════════════════════
  //  ORDERS TAB
  // ════════════════════════════════════════════════════════════════
  const OrdersTab=()=>(
    <div style={{flex:1,overflow:"auto"}}>
      <div style={S.card}>
        <div style={S.ct}>ORDER BOOK ({orders.length} orders)</div>
        <div style={{...S.row(false),gridTemplateColumns:"130px 75px 52px 42px 72px 72px 58px 72px auto",color:C.mu,fontSize:"8px",letterSpacing:"1px"}}>
          {["ORDER ID","SYMBOL","SIDE","QTY","PRICE","VALUE","STATUS","STRATEGY","TIME"].map(h=><span key={h}>{h}</span>)}
        </div>
        {orders.length===0&&<div style={{color:C.mu,padding:"20px",textAlign:"center"}}>No orders yet</div>}
        {orders.map(o=>(
          <div key={o.id} style={{...S.row(false),gridTemplateColumns:"130px 75px 52px 42px 72px 72px 58px 72px auto",fontSize:"10px"}}>
            <span style={{color:C.mu,fontSize:"9px",fontFamily:"monospace"}}>{String(o.id).slice(-12)}</span>
            <span style={{color:C.tx,fontWeight:700}}>{o.sym}</span>
            <span style={{color:o.side==="BUY"?C.g:C.r}}>{o.side}</span>
            <span>{o.qty}</span>
            <span>{o.price}</span>
            <span style={{color:C.a}}>{fmt.inr(parseFloat(o.price)*o.qty)}</span>
            <span style={S.bdg(o.status==="FILLED"?C.g:C.a)}>{o.status}</span>
            <span style={S.bdg(SMETA[o.strategy]?.color||C.mu)}>{o.strategy}</span>
            <span style={{color:C.mu,fontSize:"9px"}}>{o.ts}</span>
          </div>
        ))}
      </div>
    </div>
  );

  // ════════════════════════════════════════════════════════════════
  //  SETTINGS TAB
  // ════════════════════════════════════════════════════════════════
  const SettingsTab=()=>(
    <div style={{flex:1,display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"10px",overflow:"auto"}}>
      <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
        <div style={S.card}>
          <div style={S.ct}>GROWW API CREDENTIALS</div>
          {[{l:"ACCESS TOKEN",k:"growwToken",ph:"eyJhbGci…",note:"groww.in/user/profile/trading-apis"},{l:"AI API KEY",k:"anthropicKey",ph:"sk-…",note:"Vega AI credentials"}].map(f=>(
            <div key={f.k} style={{marginBottom:10}}>
              <div style={{color:C.mu,fontSize:"8px",letterSpacing:"1px",marginBottom:3}}>{f.l}</div>
              <input type="password" value={settings[f.k]} onChange={e=>setSettings(s=>({...s,[f.k]:e.target.value}))} placeholder={f.ph} style={S.inp}/>
              <div style={{color:C.mu,fontSize:"8px",marginTop:2}}>{f.note}</div>
            </div>
          ))}
          <div onClick={()=>setSettings(s=>({...s,paperMode:!s.paperMode}))}
            style={{border:`1px solid ${settings.paperMode?C.a:C.r}`,borderRadius:3,padding:"10px",textAlign:"center",cursor:"pointer",background:settings.paperMode?C.a+"11":C.r+"11"}}>
            <div style={{color:settings.paperMode?C.a:C.r,fontWeight:700}}>{settings.paperMode?"📝 PAPER TRADING MODE":"⚡ LIVE TRADING — REAL MONEY"}</div>
            <div style={{color:C.mu,fontSize:"9px",marginTop:2}}>{settings.paperMode?"Orders are simulated, no real execution":"WARNING: Real orders sent to Groww"}</div>
          </div>
        </div>
        <div style={S.card}>
          <div style={S.ct}>MARKET HOURS SCHEDULE</div>
          <div onClick={()=>setEngine(e=>({...e,autoSchedule:!e.autoSchedule}))}
            style={{border:`1px solid ${engine.autoSchedule?C.g:C.b}`,borderRadius:3,padding:"12px",cursor:"pointer",background:engine.autoSchedule?C.g+"11":C.bg3,marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{color:engine.autoSchedule?C.g:C.tx,fontWeight:700,fontSize:"13px"}}>{engine.autoSchedule?"🕘 AUTO SCHEDULE ON":"🕘 AUTO SCHEDULE OFF"}</div>
                <div style={{color:C.mu,fontSize:"9px",marginTop:3}}>Auto start at 9:15 AM, stop at 3:30 PM IST</div>
              </div>
              <div style={{width:40,height:22,borderRadius:11,background:engine.autoSchedule?C.g:C.mu,position:"relative",transition:"background .2s",flexShrink:0}}>
                <div style={{position:"absolute",top:3,left:engine.autoSchedule?21:3,width:16,height:16,borderRadius:8,background:"#fff",transition:"left .2s"}}/>
              </div>
            </div>
          </div>
          <div style={{fontSize:"10px",color:C.mu,lineHeight:1.9}}>
            <div style={{display:"flex",justifyContent:"space-between"}}><span>Market</span><span style={{color:marketStatus.isOpen?C.g:C.r,fontWeight:600}}>{marketStatus.isOpen?"OPEN":"CLOSED"}</span></div>
            <div style={{display:"flex",justifyContent:"space-between"}}><span>Session</span><span>Mon–Fri, 9:15 AM – 3:30 PM IST</span></div>
            <div style={{display:"flex",justifyContent:"space-between"}}><span>Status</span><span style={{color:C.b}}>{marketStatus.nextEvent}</span></div>
            <div style={{display:"flex",justifyContent:"space-between"}}><span>Holiday check</span><span>NSE 2026 calendar</span></div>
          </div>
          <div style={{marginTop:8,padding:"6px 8px",background:C.bg3,borderRadius:3,fontSize:"9px",color:C.mu,lineHeight:1.6}}>
            When enabled, the engine automatically starts scanning at market open and stops at close. Includes NSE holiday detection. You can still manually stop the engine during market hours.
          </div>
        </div>
        <div style={S.card}>
          <div style={S.ct}>GROWW API ENDPOINTS</div>
          {[["POST","/v1/order/create","Place order"],["GET","/v1/order/detail/{id}","Order status"],["POST","/v1/order/cancel","Cancel order"],["POST","/v1/smart-order/create","OCO/GTT orders"],["GET","/v1/live-data/ltp","Live price"],["GET","/v1/live-data/ohlc","OHLC data"],["GET","/v1/historical-data","Candle history"],["GET","/v1/portfolio/positions","Positions"],["GET","/v1/portfolio/holdings","Holdings"],["GET","/v1/user/funds","Fund balance"]].map(([m,ep,d])=>(
            <div key={ep} style={{display:"flex",gap:5,padding:"4px 0",borderBottom:`1px solid ${C.bg3}`,fontSize:"9px",alignItems:"center"}}>
              <span style={S.bdg(m==="GET"?C.b:C.a)}>{m}</span>
              <span style={{color:C.tx,fontFamily:"monospace",flex:1}}>{ep}</span>
              <span style={{color:C.mu}}>{d}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
        <div style={S.card}>
          <div style={S.ct}>ATR CHANDELIER STOP ENGINE</div>
          <div style={{fontSize:"10px",color:C.mu,lineHeight:1.9}}>
            <div style={{color:C.tx,marginBottom:5}}>Algorithm: <span style={{color:C.g}}>Chandelier Exit v2 (Ratchet)</span></div>
            <div>• ATR period: <span style={{color:C.a}}>14 candles</span></div>
            <div>• Active mult: <span style={{color:C.a}}>{engine.atrMult}×</span></div>
            <div>• LONG SL = HighestHigh(14) − ATR × mult</div>
            <div>• SHORT SL = LowestLow(14) + ATR × mult</div>
            <div>• Stop <span style={{color:C.g}}>ratchets up only</span> — never retreats</div>
            <div>• Widens in volatile markets automatically</div>
            <div>• Checked every tick (30s market update)</div>
            <div style={{marginTop:6,padding:"6px 8px",background:C.bg3,borderRadius:3,color:C.mu,fontSize:"9px"}}>
              Minimum R:R = {(engine.atrMult*1.5/engine.atrMult).toFixed(1)}×. Min confidence = {(engine.minStrength*100).toFixed(0)}%. Position size = Risk ₹ ÷ SL distance per share.
            </div>
          </div>
        </div>
        <div style={S.card}>
          <div style={S.ct}>DEPLOYMENT</div>
          <div style={{background:C.bg3,borderRadius:3,padding:"10px",fontFamily:"monospace",fontSize:"9px",lineHeight:1.9,color:C.mu}}>
            <div style={{color:C.b}}># 1. Init project</div>
            <div>npx create-vega@latest</div>
            <div style={{color:C.b}}># 2. Deploy React frontend</div>
            <div>npm run build</div>
            <div>vega pages deploy dist</div>
            <div style={{color:C.b}}># 3. Deploy trading worker</div>
            <div>vega deploy worker/engine.js</div>
            <div style={{color:C.b}}># 4. Set secrets</div>
            <div>vega secret put GROWW_TOKEN</div>
            <div>vega secret put AI_API_KEY</div>
            <div style={{color:C.b}}># 5. Cron (IST 9:15–15:30)</div>
            <div>crons = ["*/1 3-10 * * 1-5"]</div>
          </div>
          <div style={{marginTop:6,color:C.mu,fontSize:"9px",lineHeight:1.7}}>
            KV → position state · D1 → trade history · Durable Objects → real-time sync · Cron Triggers → market-hour automation
          </div>
        </div>
      </div>

      <div style={S.card}>
        <div style={S.ct}>STRATEGY DETAILS</div>
        {Object.entries(SMETA).map(([id,meta])=>(
          <div key={id} style={{marginBottom:10,padding:"8px",background:engine.strategies[id]?meta.color+"08":C.bg3,border:`1px solid ${engine.strategies[id]?meta.color+"30":C.bd}`,borderRadius:3}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
              <div style={{color:meta.color,fontWeight:700}}>{meta.name}</div>
              <span style={S.bdg(engine.strategies[id]?C.g:C.mu)}>{engine.strategies[id]?"ACTIVE":"OFF"}</span>
            </div>
            <div style={{color:C.mu,fontSize:"9px",lineHeight:1.7}}>
              {id==="momentum"   &&<><div>Entry: EMA9 crosses EMA21 upward</div><div>Filter: RSI between 45–72</div><div>Exit: EMA9 crosses below EMA21</div></>}
              {id==="supertrend" &&<><div>Entry: SuperTrend flips bullish (trend -1→1)</div><div>Config: Period 10, Multiplier 3</div><div>Exit: ST flips bearish</div></>}
              {id==="mean_rev"   &&<><div>Entry: Price touches lower BB + RSI &lt;35</div><div>Target: Bollinger Band midline (SMA20)</div><div>Exit: Price at upper BB or RSI &gt;65</div></>}
              {id==="breakout"   &&<><div>Entry: 20-bar high break + vol &gt;1.5× avg</div><div>Stop: Below breakout level − ATR</div><div>Exit: Target = 2.5× ATR from entry</div></>}
              {id==="macd"       &&<><div>Entry: MACD crosses signal below zero line</div><div>Config: 12/26/9 standard parameters</div><div>Exit: MACD crosses signal above zero</div></>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // ════════════════════════════════════════════════════════════════
  //  RENDER
  // ════════════════════════════════════════════════════════════════
  const TABS=[{id:"engine",l:"AUTO ENGINE"},{id:"positions",l:"POSITIONS"},{id:"scanner",l:"SCANNER"},{id:"ai",l:"AI AGENT"},{id:"orders",l:"ORDERS"},{id:"settings",l:"SETTINGS"}];

  return (
    <div style={S.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:3px;height:3px}::-webkit-scrollbar-track{background:${C.scrollTrack}}::-webkit-scrollbar-thumb{background:${C.scrollThumb};border-radius:2px}
        input:focus,select:focus{border-color:${C.g}!important;box-shadow:0 0 0 1px ${C.g}33}
        button:hover{opacity:.82}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
      `}</style>

      {/* TOPBAR */}
      <div style={S.topbar}>
        <div style={S.logo}>⚡ VEGA</div>
        {indices.map(idx=>(
          <div key={idx.name} style={{padding:"5px 12px",borderRadius:6,background:idx.changePct>=0?C.g+"10":C.r+"10",border:`1px solid ${idx.changePct>=0?C.g+"30":C.r+"30"}`,marginRight:8}}>
            <span style={{color:C.mu,fontSize:"10px",marginRight:6,fontFamily:FONT_UI}}>{idx.name}</span>
            <span style={{color:idx.changePct>=0?C.g:C.r,fontWeight:700,fontSize:"13px"}}>{idx.current.toLocaleString("en-IN",{maximumFractionDigits:1})}</span>
            <span style={{color:idx.changePct>=0?C.g:C.r,fontSize:"11px",marginLeft:5}}>{fmt.pct(idx.changePct)}</span>
          </div>
        ))}
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:12}}>
          <span style={{color:C.mu,fontSize:"12px",fontFamily:FONT_MONO}}>{new Date().toLocaleTimeString("en-IN")}</span>
          <span style={S.bdg(settings.paperMode?C.a:C.r)}>{settings.paperMode?"PAPER":"LIVE"}</span>
          <span style={S.bdg(engine.running?C.g:C.mu)}>{engine.running?"RUNNING":"IDLE"}</span>
          {engine.autoSchedule && <span style={S.bdg(marketStatus.isOpen?C.g:C.b)} title="Auto schedule active">⏰</span>}
          <span style={{color:C.mu,fontSize:"11px",fontFamily:FONT_UI}}>{positions.length} pos · {signals.length} sig</span>
          <button onClick={toggleTheme}
            style={{background:C.bg3,border:`1px solid ${C.bd}`,borderRadius:6,padding:"6px 12px",cursor:"pointer",fontSize:"14px",color:C.tx,lineHeight:1,transition:"all .2s",display:"flex",alignItems:"center",gap:6}}
            title={theme==="dark"?"Switch to light theme":"Switch to dark theme"}>
            {theme==="dark"?"☀️":"🌙"}<span style={{fontSize:"10px",fontFamily:FONT_UI,fontWeight:500}}>{theme==="dark"?"Light":"Dark"}</span>
          </button>
          {user && <>
            <span style={{color:C.g,fontSize:"12px",fontWeight:600,fontFamily:FONT_UI}}>{user.username}</span>
            <button onClick={onLogout}
              style={{background:"transparent",border:`1px solid ${C.mu}`,borderRadius:6,color:C.mu,padding:"5px 10px",fontFamily:FONT_UI,fontSize:"10px",cursor:"pointer",letterSpacing:"1px",fontWeight:600,transition:"all .2s"}}>
              LOGOUT
            </button>
          </>}
          <div style={{width:8,height:8,borderRadius:"50%",background:C.g,boxShadow:`0 0 8px ${C.g}`}}/>
        </div>
      </div>

      {/* NAV */}
      <div style={S.nav}>
        {TABS.map(t=><button key={t.id} style={S.nb(tab===t.id)} onClick={()=>setTab(t.id)}>{t.l}</button>)}
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",padding:"0 12px"}}>
          <span style={{color:C.g,fontSize:"11px",fontFamily:FONT_UI,fontWeight:600}}>● LIVE API</span>
        </div>
      </div>

      {/* BODY */}
      <div style={S.body}>
        {marketLoading ? (
          <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16}}>
            <div style={{color:C.g,fontSize:"28px",fontWeight:700,fontFamily:FONT_UI,letterSpacing:"6px",animation:"pulse 1.5s infinite"}}>⚡ VEGA</div>
            <div style={{color:C.mu,fontSize:"13px",fontFamily:FONT_UI}}>Loading real-time market data…</div>
            <div style={{color:C.mu,fontSize:"11px",fontFamily:FONT_MONO}}>Fetching {watchlistSymbols.length} stocks + {INDEX_SYMBOLS.length} indices</div>
          </div>
        ) : (
          <>
            {tab==="engine"    && <EngineTab/>}
            {tab==="positions" && <PositionsTab/>}
            {tab==="scanner"   && <ScannerTab/>}
            {tab==="ai"        && <AITab/>}
            {tab==="orders"    && <OrdersTab/>}
            {tab==="settings"  && <SettingsTab/>}
          </>
        )}
      </div>
    </div>
  );
}
