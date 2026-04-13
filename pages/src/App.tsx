import { useState, useEffect, useRef, useCallback } from "react";
import { api, type Quote, type Analysis, type Indicators, type HistoryPoint } from "./api";

// ─── Styles ───────────────────────────────────────────
const CSS = `
:root {
  --bg: #0a0e17; --bg2: #111827; --bg3: #1e293b;
  --border: #1e293b; --border2: #334155;
  --text: #e2e8f0; --text2: #94a3b8; --text3: #64748b;
  --cyan: #22d3ee; --green: #10b981; --red: #ef4444;
  --yellow: #f59e0b; --purple: #a78bfa; --blue: #3b82f6;
}
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: -apple-system, 'SF Pro', 'Inter', system-ui, sans-serif; background:var(--bg); color:var(--text); }
input, button, textarea { font-family: inherit; }
::-webkit-scrollbar { width:6px; } ::-webkit-scrollbar-track { background:var(--bg2); } ::-webkit-scrollbar-thumb { background:var(--border2); border-radius:3px; }

.app { display:flex; height:100vh; overflow:hidden; }
.sidebar { width:280px; background:var(--bg2); border-right:1px solid var(--border); display:flex; flex-direction:column; flex-shrink:0; }
.sidebar-header { padding:20px; border-bottom:1px solid var(--border); }
.logo { display:flex; align-items:center; gap:10px; font-size:20px; font-weight:700; color:var(--cyan); }
.logo svg { width:28px; height:28px; }
.main { flex:1; display:flex; flex-direction:column; overflow:hidden; }

.search-box { margin:16px; position:relative; }
.search-input { width:100%; padding:10px 14px; background:var(--bg3); border:1px solid var(--border); border-radius:10px; color:var(--text); font-size:14px; outline:none; transition:border-color .2s; }
.search-input:focus { border-color:var(--cyan); }
.search-results { position:absolute; top:100%; left:0; right:0; background:var(--bg2); border:1px solid var(--border2); border-radius:10px; margin-top:4px; max-height:240px; overflow-y:auto; z-index:100; }
.search-item { padding:10px 14px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; transition:background .15s; }
.search-item:hover { background:var(--bg3); }
.search-item .sym { font-weight:600; color:var(--cyan); }
.search-item .name { font-size:12px; color:var(--text2); }

.watchlist { flex:1; overflow-y:auto; padding:0 8px; }
.watchlist-title { padding:12px 8px 8px; font-size:11px; text-transform:uppercase; letter-spacing:1px; color:var(--text3); font-weight:600; }
.watch-item { display:flex; justify-content:space-between; align-items:center; padding:10px 12px; border-radius:8px; cursor:pointer; transition:background .15s; margin-bottom:2px; }
.watch-item:hover, .watch-item.active { background:var(--bg3); }
.watch-sym { font-weight:600; font-size:14px; }
.watch-price { text-align:right; }
.watch-price .price { font-size:14px; font-weight:500; }
.watch-price .change { font-size:12px; }

.top-bar { display:flex; align-items:center; justify-content:space-between; padding:16px 24px; border-bottom:1px solid var(--border); background:var(--bg2); }
.stock-info { display:flex; align-items:baseline; gap:16px; }
.stock-symbol { font-size:24px; font-weight:700; }
.stock-name { font-size:14px; color:var(--text2); }
.stock-price { font-size:28px; font-weight:700; }
.stock-change { font-size:16px; font-weight:500; padding:4px 10px; border-radius:6px; }
.up { color:var(--green); } .down { color:var(--red); }
.bg-up { background:rgba(16,185,129,.12); } .bg-down { background:rgba(239,68,68,.12); }

.content { display:grid; grid-template-columns:1fr 380px; flex:1; overflow:hidden; }
.chart-area { padding:24px; overflow-y:auto; }
.chat-panel { border-left:1px solid var(--border); display:flex; flex-direction:column; background:var(--bg2); }

.chart-container { background:var(--bg2); border:1px solid var(--border); border-radius:12px; padding:20px; margin-bottom:20px; min-height:360px; }
.chart-canvas { width:100%; height:320px; background:var(--bg); border-radius:8px; position:relative; overflow:hidden; }

.indicators-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:12px; margin-bottom:20px; }
.indicator-card { background:var(--bg2); border:1px solid var(--border); border-radius:10px; padding:14px; }
.indicator-label { font-size:11px; color:var(--text3); text-transform:uppercase; letter-spacing:.5px; margin-bottom:4px; }
.indicator-value { font-size:18px; font-weight:600; }

.analysis-card { background:var(--bg2); border:1px solid var(--border); border-radius:12px; padding:20px; margin-bottom:20px; }
.signal-badge { display:inline-flex; align-items:center; gap:6px; padding:6px 14px; border-radius:20px; font-weight:700; font-size:14px; }
.signal-STRONG_BUY,.signal-BUY { background:rgba(16,185,129,.15); color:var(--green); }
.signal-HOLD { background:rgba(245,158,11,.15); color:var(--yellow); }
.signal-SELL,.signal-STRONG_SELL { background:rgba(239,68,68,.15); color:var(--red); }
.confidence-bar { height:6px; background:var(--bg3); border-radius:3px; margin-top:12px; overflow:hidden; }
.confidence-fill { height:100%; border-radius:3px; transition:width .5s; }
.analysis-section { margin-top:16px; }
.analysis-section h4 { font-size:13px; color:var(--text3); text-transform:uppercase; letter-spacing:.5px; margin-bottom:8px; }
.analysis-section p { font-size:14px; line-height:1.6; color:var(--text2); }
.catalyst-tag { display:inline-block; background:var(--bg3); border:1px solid var(--border2); padding:4px 10px; border-radius:6px; font-size:12px; color:var(--text2); margin:2px; }

.chat-header { padding:16px 20px; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; }
.chat-header h3 { font-size:15px; font-weight:600; }
.model-select { background:var(--bg3); border:1px solid var(--border); border-radius:6px; color:var(--text); padding:4px 8px; font-size:12px; outline:none; }
.chat-messages { flex:1; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:12px; }
.msg { max-width:90%; padding:10px 14px; border-radius:12px; font-size:14px; line-height:1.5; white-space:pre-wrap; }
.msg.user { align-self:flex-end; background:var(--cyan); color:var(--bg); border-bottom-right-radius:4px; }
.msg.assistant { align-self:flex-start; background:var(--bg3); border-bottom-left-radius:4px; }
.chat-input-area { padding:12px 16px; border-top:1px solid var(--border); display:flex; gap:8px; }
.chat-input { flex:1; padding:10px 14px; background:var(--bg3); border:1px solid var(--border); border-radius:10px; color:var(--text); font-size:14px; outline:none; resize:none; min-height:40px; max-height:120px; }
.chat-input:focus { border-color:var(--cyan); }
.send-btn { padding:10px 16px; background:var(--cyan); color:var(--bg); border:none; border-radius:10px; font-weight:600; cursor:pointer; transition:opacity .15s; white-space:nowrap; }
.send-btn:hover { opacity:.85; } .send-btn:disabled { opacity:.4; cursor:not-allowed; }

.analyze-btn { padding:8px 16px; background:linear-gradient(135deg, var(--cyan), var(--blue)); color:var(--bg); border:none; border-radius:8px; font-weight:600; font-size:13px; cursor:pointer; transition:opacity .15s; }
.analyze-btn:hover { opacity:.85; } .analyze-btn:disabled { opacity:.4; }

.range-tabs { display:flex; gap:4px; margin-bottom:16px; }
.range-tab { padding:6px 12px; background:var(--bg3); border:1px solid var(--border); border-radius:6px; color:var(--text2); font-size:12px; cursor:pointer; transition:all .15s; }
.range-tab.active { background:var(--cyan); color:var(--bg); border-color:var(--cyan); }

.loading { display:flex; align-items:center; justify-content:center; padding:40px; color:var(--text3); }
.spinner { width:20px; height:20px; border:2px solid var(--border); border-top-color:var(--cyan); border-radius:50%; animation:spin .6s linear infinite; margin-right:10px; }
@keyframes spin { to { transform:rotate(360deg); } }

.disclaimer { font-size:11px; color:var(--text3); padding:12px 20px; border-top:1px solid var(--border); text-align:center; line-height:1.4; }

.empty-state { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:var(--text3); text-align:center; padding:40px; }
.empty-state svg { width:64px; height:64px; margin-bottom:16px; opacity:.3; }
.empty-state h2 { font-size:20px; color:var(--text2); margin-bottom:8px; }
.empty-state p { font-size:14px; max-width:360px; }

@media (max-width: 1024px) {
  .sidebar { display:none; }
  .content { grid-template-columns:1fr; }
  .chat-panel { display:none; }
}
`;

// ─── Mini SVG Chart ───────────────────────────────────
function MiniChart({ data, width = 800, height = 300 }: { data: HistoryPoint[]; width?: number; height?: number }) {
  if (!data.length) return null;
  const closes = data.map(d => d.close).filter(Boolean);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const points = closes.map((c, i) => {
    const x = (i / (closes.length - 1)) * width;
    const y = height - ((c - min) / range) * (height - 20) - 10;
    return `${x},${y}`;
  }).join(" ");

  const isUp = closes[closes.length - 1] >= closes[0];
  const color = isUp ? "#10b981" : "#ef4444";
  const gradId = "chartGrad";

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "100%" }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${height} ${points} ${width},${height}`}
        fill={`url(#${gradId})`}
      />
      <polyline points={points} fill="none" stroke={color} strokeWidth="2.5" />
    </svg>
  );
}

// ─── Main App ─────────────────────────────────────────
export default function App() {
  const [activeSymbol, setActiveSymbol] = useState<string>("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [indicators, setIndicators] = useState<Indicators | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [range, setRange] = useState("6mo");
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [watchlist, setWatchlist] = useState<Quote[]>([]);
  const [chatMessages, setChatMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [model, setModel] = useState("sonnet-4.6");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const searchTimeout = useRef<any>(null);

  const DEFAULT_WATCHLIST = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "TSLA", "META", "^GSPC"];

  // Load watchlist on mount
  useEffect(() => {
    api.getWatchlist(DEFAULT_WATCHLIST).then(setWatchlist).catch(console.error);
  }, []);

  // Load stock data when symbol changes
  const loadStock = useCallback(async (symbol: string) => {
    if (!symbol) return;
    setActiveSymbol(symbol);
    setLoading(true);
    setAnalysis(null);
    try {
      const [q, h] = await Promise.all([
        api.getQuote(symbol),
        api.getHistory(symbol, range),
      ]);
      setQuote(q);
      setHistory(h.history);
      setIndicators(h.indicators);
    } catch (err) {
      console.error("Failed to load stock:", err);
    } finally {
      setLoading(false);
    }
  }, [range]);

  // Reload when range changes
  useEffect(() => {
    if (activeSymbol) loadStock(activeSymbol);
  }, [range]);

  // Search debounce
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(async () => {
      try {
        const results = await api.search(searchQuery);
        setSearchResults(results);
        setShowSearch(true);
      } catch { setSearchResults([]); }
    }, 300);
    return () => clearTimeout(searchTimeout.current);
  }, [searchQuery]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // Run AI analysis
  const runAnalysis = async () => {
    if (!activeSymbol) return;
    setAnalyzing(true);
    try {
      const result = await api.analyze(activeSymbol, model);
      setAnalysis(result.analysis);
      // Update quote/indicators with fresh data
      setQuote(result.quote);
      setIndicators(result.indicators);
    } catch (err) {
      console.error("Analysis failed:", err);
    } finally {
      setAnalyzing(false);
    }
  };

  // Send chat message
  const sendChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg = { role: "user", content: chatInput };
    const newMessages = [...chatMessages, userMsg];
    setChatMessages(newMessages);
    setChatInput("");
    setChatLoading(true);
    try {
      const result = await api.chat(newMessages, activeSymbol, model);
      setChatMessages([...newMessages, { role: "assistant", content: result.response }]);
    } catch (err: any) {
      setChatMessages([...newMessages, { role: "assistant", content: `Error: ${err.message}` }]);
    } finally {
      setChatLoading(false);
    }
  };

  const fmt = (n: number, d = 2) => n?.toFixed(d) ?? "—";
  const fmtVol = (n: number) => n >= 1e9 ? `${(n/1e9).toFixed(1)}B` : n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : `${(n/1e3).toFixed(0)}K`;

  return (
    <>
      <style>{CSS}</style>
      <div className="app">
        {/* Sidebar */}
        <div className="sidebar">
          <div className="sidebar-header">
            <div className="logo">
              <svg viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#0f172a"/><path d="M6 22 L12 14 L18 18 L26 8" stroke="#22d3ee" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/><circle cx="26" cy="8" r="2.5" fill="#22d3ee"/></svg>
              Stock AI
            </div>
          </div>
          <div className="search-box">
            <input
              className="search-input"
              placeholder="Search stocks..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onFocus={() => searchResults.length && setShowSearch(true)}
              onBlur={() => setTimeout(() => setShowSearch(false), 200)}
            />
            {showSearch && searchResults.length > 0 && (
              <div className="search-results">
                {searchResults.map(r => (
                  <div key={r.symbol} className="search-item" onClick={() => { loadStock(r.symbol); setShowSearch(false); setSearchQuery(""); }}>
                    <span><span className="sym">{r.symbol}</span></span>
                    <span className="name">{r.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="watchlist-title">Watchlist</div>
          <div className="watchlist">
            {watchlist.map(w => (
              <div key={w.symbol} className={`watch-item ${w.symbol === activeSymbol ? "active" : ""}`} onClick={() => loadStock(w.symbol)}>
                <div>
                  <div className="watch-sym">{w.symbol}</div>
                  <div style={{ fontSize: 11, color: "var(--text3)" }}>{w.name?.slice(0, 20)}</div>
                </div>
                <div className="watch-price">
                  <div className="price">${fmt(w.price)}</div>
                  <div className={`change ${w.changePercent >= 0 ? "up" : "down"}`}>
                    {w.changePercent >= 0 ? "+" : ""}{fmt(w.changePercent)}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Main Content */}
        <div className="main">
          {activeSymbol && quote ? (
            <>
              {/* Top Bar */}
              <div className="top-bar">
                <div className="stock-info">
                  <span className="stock-symbol">{quote.symbol}</span>
                  <span className="stock-name">{quote.name}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <div>
                    <span className="stock-price">${fmt(quote.price)}</span>
                    <span className={`stock-change ${quote.changePercent >= 0 ? "up bg-up" : "down bg-down"}`}>
                      {quote.changePercent >= 0 ? "+" : ""}{fmt(quote.change)} ({fmt(quote.changePercent)}%)
                    </span>
                  </div>
                  <button className="analyze-btn" onClick={runAnalysis} disabled={analyzing}>
                    {analyzing ? "Analyzing..." : "AI Analysis"}
                  </button>
                </div>
              </div>

              {/* Content Grid */}
              <div className="content">
                <div className="chart-area">
                  {loading ? (
                    <div className="loading"><div className="spinner" /> Loading...</div>
                  ) : (
                    <>
                      {/* Chart */}
                      <div className="chart-container">
                        <div className="range-tabs">
                          {["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y"].map(r => (
                            <div key={r} className={`range-tab ${range === r ? "active" : ""}`} onClick={() => setRange(r)}>{r.toUpperCase()}</div>
                          ))}
                        </div>
                        <div className="chart-canvas">
                          <MiniChart data={history} />
                        </div>
                      </div>

                      {/* Indicators */}
                      {indicators && (
                        <div className="indicators-grid">
                          <div className="indicator-card"><div className="indicator-label">RSI (14)</div><div className="indicator-value" style={{ color: indicators.rsi > 70 ? "var(--red)" : indicators.rsi < 30 ? "var(--green)" : "var(--text)" }}>{fmt(indicators.rsi, 1)}</div></div>
                          <div className="indicator-card"><div className="indicator-label">MACD</div><div className="indicator-value" style={{ color: indicators.macd > 0 ? "var(--green)" : "var(--red)" }}>{fmt(indicators.macd, 4)}</div></div>
                          <div className="indicator-card"><div className="indicator-label">SMA 50</div><div className="indicator-value">${fmt(indicators.sma50)}</div></div>
                          <div className="indicator-card"><div className="indicator-label">SMA 200</div><div className="indicator-value">${fmt(indicators.sma200)}</div></div>
                          <div className="indicator-card"><div className="indicator-label">VWAP</div><div className="indicator-value">${fmt(indicators.vwap)}</div></div>
                          <div className="indicator-card"><div className="indicator-label">ATR (14)</div><div className="indicator-value">${fmt(indicators.atr)}</div></div>
                          <div className="indicator-card"><div className="indicator-label">Bollinger Upper</div><div className="indicator-value">${fmt(indicators.bollingerUpper)}</div></div>
                          <div className="indicator-card"><div className="indicator-label">Volume</div><div className="indicator-value">{fmtVol(quote.volume)}</div></div>
                        </div>
                      )}

                      {/* AI Analysis */}
                      {analyzing && <div className="loading"><div className="spinner" /> Claude is analyzing {activeSymbol}...</div>}
                      {analysis && (
                        <div className="analysis-card">
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                            <div>
                              <span className={`signal-badge signal-${analysis.signal}`}>
                                {analysis.signal === "STRONG_BUY" ? "STRONG BUY" : analysis.signal === "STRONG_SELL" ? "STRONG SELL" : analysis.signal}
                              </span>
                              <span style={{ marginLeft: 12, fontSize: 13, color: "var(--text3)" }}>via {analysis.model}</span>
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <div style={{ fontSize: 12, color: "var(--text3)" }}>Target: <span style={{ color: "var(--green)", fontWeight: 600 }}>${fmt(analysis.targetPrice)}</span></div>
                              <div style={{ fontSize: 12, color: "var(--text3)" }}>Stop Loss: <span style={{ color: "var(--red)", fontWeight: 600 }}>${fmt(analysis.stopLoss)}</span></div>
                            </div>
                          </div>
                          <div className="confidence-bar">
                            <div className="confidence-fill" style={{ width: `${analysis.confidence}%`, background: analysis.confidence > 70 ? "var(--green)" : analysis.confidence > 40 ? "var(--yellow)" : "var(--red)" }} />
                          </div>
                          <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>Confidence: {analysis.confidence}% | Horizon: {analysis.timeHorizon}</div>
                          <div className="analysis-section"><h4>Summary</h4><p>{analysis.summary}</p></div>
                          <div className="analysis-section"><h4>Technical Analysis</h4><p>{analysis.technicalAnalysis}</p></div>
                          <div className="analysis-section"><h4>Risk Assessment</h4><p>{analysis.riskAssessment}</p></div>
                          {analysis.catalysts?.length > 0 && (
                            <div className="analysis-section">
                              <h4>Catalysts</h4>
                              <div>{analysis.catalysts.map((c, i) => <span key={i} className="catalyst-tag">{c}</span>)}</div>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Chat Panel */}
                <div className="chat-panel">
                  <div className="chat-header">
                    <h3>AI Chat</h3>
                    <select className="model-select" value={model} onChange={e => setModel(e.target.value)}>
                      <option value="opus-4.6">Opus 4.6</option>
                      <option value="sonnet-4.6">Sonnet 4.6</option>
                      <option value="haiku-4.5">Haiku 4.5</option>
                    </select>
                  </div>
                  <div className="chat-messages">
                    {chatMessages.length === 0 && (
                      <div style={{ textAlign: "center", color: "var(--text3)", marginTop: 40, fontSize: 13 }}>
                        Ask anything about stocks, markets, or trading strategies. Claude will use real-time data for analysis.
                      </div>
                    )}
                    {chatMessages.map((m, i) => (
                      <div key={i} className={`msg ${m.role}`}>{m.content}</div>
                    ))}
                    {chatLoading && <div className="msg assistant"><div className="spinner" style={{ display: "inline-block" }} /></div>}
                    <div ref={chatEndRef} />
                  </div>
                  <div className="chat-input-area">
                    <textarea
                      className="chat-input"
                      placeholder={`Ask about ${activeSymbol || "any stock"}...`}
                      value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                      rows={1}
                    />
                    <button className="send-btn" onClick={sendChat} disabled={chatLoading || !chatInput.trim()}>Send</button>
                  </div>
                  <div className="disclaimer">AI analysis is for educational purposes only. Not financial advice.</div>
                </div>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <svg viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#0f172a"/><path d="M6 22 L12 14 L18 18 L26 8" stroke="#22d3ee" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/><circle cx="26" cy="8" r="2.5" fill="#22d3ee"/></svg>
              <h2>Welcome to Stock AI</h2>
              <p>Select a stock from your watchlist or search for any ticker to get AI-powered analysis with buy/sell signals.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
