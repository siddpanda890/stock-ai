# Stock AI - AI-Powered Trading Intelligence

Full-stack AI stock analysis platform with buy/sell signals powered by Claude via Vertex AI.

## Architecture

- **Backend**: Cloudflare Workers (Hono) - stock data, AI analysis, chat
- **Frontend**: React + Vite on Cloudflare Pages
- **AI**: Claude Opus 4.6 / Sonnet 4.6 / Haiku 4.5 via Google Vertex AI
- **Data**: Yahoo Finance (real-time quotes, historical data, technical indicators)

## Features

- Real-time stock quotes and charts
- Technical indicators (RSI, MACD, Bollinger, SMA, VWAP, ATR)
- AI-powered buy/sell signals with confidence scores
- Target price and stop-loss recommendations
- AI chat for market analysis
- Watchlist with live prices
- Model selection (Opus/Sonnet/Haiku)

## Setup

```bash
# Worker
cd worker && npm install
npx wrangler secret put VERTEX_SERVICE_ACCOUNT_JSON
npx wrangler secret put ANTHROPIC_API_KEY
npm run deploy

# Pages
cd pages && npm install
npm run build
npx wrangler pages deploy dist --project-name=stock-ai-dashboard
```
