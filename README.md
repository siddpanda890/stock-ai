# VegaTrade - AI-Powered Trading Intelligence

Full-stack AI stock analysis platform with buy/sell signals powered by Vega AI.

## Architecture

- **Backend**: Edge Workers (Hono) - stock data, AI analysis, chat
- **Frontend**: React + Vite on Edge Pages
- **AI**: Vega Ultra / Vega Pro / Vega Lite multi-model pipeline
- **Data**: Real-time market data (quotes, historical data, technical indicators)

## Features

- Real-time stock quotes and charts
- Technical indicators (RSI, MACD, Bollinger, SMA, VWAP, ATR)
- AI-powered buy/sell signals with confidence scores
- Target price and stop-loss recommendations
- AI chat for market analysis
- Watchlist with live prices
- Model selection (Ultra/Pro/Lite)

## Setup

```bash
# Worker
cd worker && npm install
npx wrangler secret put VERTEX_SERVICE_ACCOUNT_JSON
npx wrangler secret put AI_API_KEY
npm run deploy

# Pages
cd pages && npm install
npm run build
npx wrangler pages deploy dist --project-name=stock-ai-dashboard
```
