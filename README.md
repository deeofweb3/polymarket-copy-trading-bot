# Polymarket Trading Bot / Polymarket Copy Trading Bot

This polymarket trading bot is a TypeScript / Node.js polymarket copy trading bot that mirrors selected Polymarket traders’ activity at your own size, using Polymarket’s public APIs and the official CLOB client.

**Keywords:** polymarket trading bot, polymarket copy trading bot, Polymarket trading bot automation, Polymarket copy trading bot strategy

**License:** [ISC](https://opensource.org/licenses/ISC)

## Overview - Polymarket Trading Bot

You configure one or more **trader addresses** (`USER_ADDRESSES`) and your own Polygon wallet (`PROXY_WALLET` + `PRIVATE_KEY`). This polymarket trading bot polls Polymarket’s **data API** for those wallets’ trades, stores activity in **MongoDB**, and places mirrored orders through the **CLOB** with limits you set (copy strategy, min/max order size, aggregation, etc.).

In practice, this polymarket copy trading bot helps automate monitoring, position mirroring, and execution risk controls for users who want a systematic polymarket trading bot workflow.

Midpoint / reference prices for logging are resolved in **`src/utils/polymarketTokenPrice.ts`**: if present, an optional **native addon** under `node/` may be loaded first; otherwise (or if it fails) the bot uses the **HTTP CLOB** endpoint `GET {CLOB_HTTP_URL}/midpoint?token_id=…`. Only use native binaries you built or fully trust.

## Requirements for the Polymarket Copy Trading Bot

- **Node.js** 18+ (LTS recommended)
- **MongoDB** connection string (`MONGO_URI`) — e.g. [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
- **Polygon** wallet with **USDC** for trading, and a reliable **RPC** (`RPC_URL`)
- Polymarket **CLOB** URLs (`CLOB_HTTP_URL`, `CLOB_WS_URL`) — defaults match Polymarket’s public endpoints

## Quick Start - Polymarket Trading Bot Setup

```bash
git clone https://github.com/PhamHVAnh/polymarket-copy-trading-bot.git
cd polymarket-copy-trading-bot
npm install
cp .env.example .env
# Edit .env: USER_ADDRESSES, PROXY_WALLET, PRIVATE_KEY, MONGO_URI, RPC_URL, USDC_CONTRACT_ADDRESS, etc.
npm run build
npm run health-check
npm start
```

For development without compiling:

```bash
npm run dev
```

## Configuration for This Polymarket Copy Trading Bot

Copy `.env.example` to `.env` and fill in values. Required variables (validated at startup) include:

| Variable | Purpose |
|----------|---------|
| `USER_ADDRESSES` | Comma-separated or JSON array of trader wallet addresses to copy |
| `PROXY_WALLET` | Your Polymarket proxy wallet address (must match `PRIVATE_KEY`) |
| `PRIVATE_KEY` | Hex private key for signing (64 hex chars, optional `0x`) |
| `CLOB_HTTP_URL` | CLOB REST base URL (default: `https://clob.polymarket.com/`) |
| `CLOB_WS_URL` | CLOB WebSocket URL |
| `MONGO_URI` | MongoDB connection string |
| `RPC_URL` | Polygon JSON-RPC URL |
| `USDC_CONTRACT_ADDRESS` | USDC on Polygon (see `.env.example` for default) |

Copy sizing and risk are controlled by variables such as `COPY_STRATEGY`, `COPY_SIZE`, `MAX_ORDER_SIZE_USD`, `MIN_ORDER_SIZE_USD`, `TRADE_AGGREGATION_*`, etc. See `.env.example` for the full list and comments used by this polymarket trading bot and polymarket copy trading bot flow.

## How This Polymarket Trading Bot Fits Together

```text
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  tradeMonitor   │────▶│ MongoDB          │◀────│ tradeExecutor   │
│  (poll activity)│     │ (per-address     │     │ (read pending,  │
│                 │     │  collections)    │     │  post orders)   │
└────────┬────────┘     └──────────────────┘     └────────┬────────┘
         │                                                │
         ▼                                                ▼
   data-api.polymarket.com                          CLOB + Polygon RPC
```

- **`src/services/tradeMonitor.ts`** — Fetches trader activity/positions and writes to MongoDB for the polymarket copy trading bot pipeline.
- **`src/services/tradeExecutor.ts`** — Executes copy trades via `postOrder` / CLOB client in the polymarket trading bot runtime.
- **`src/utils/createClobClient.ts`** — Builds the authenticated `ClobClient` used by the polymarket trading bot.
- **`src/config/env.ts`** — Loads and validates environment configuration for this polymarket copy trading bot.

## Useful npm Scripts for the Polymarket Copy Trading Bot

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run `node dist/index.js` |
| `npm run dev` | Run `ts-node src/index.ts` |
| `npm run health-check` | Configuration / connectivity checks |
| `npm run help` | List script commands (`src/scripts/help.ts`) |
| `npm run check-token-price` | Test midpoint price helper |
| `npm run redeem-resolved` | Redeem resolved positions (script) |
| `npm run manual-sell` / `sell-large` | Position management helpers |
| `npm run find-traders` / `scan-traders` | Discovery / analysis scripts |
| `npm run lint` | ESLint |

## Security for Polymarket Trading Bot Operations

- Use a **dedicated** wallet; never commit `.env` or share `PRIVATE_KEY`.
- Review dependencies and this codebase before mainnet use.
- The application only sends keys/signatures where your configured clients require them (RPC, CLOB, MongoDB as you configure).

## Risk Notice for Any Polymarket Trading Bot

Prediction markets involve **loss of funds**. This software is provided **as-is** without warranty. Use only capital you can afford to lose, and understand the configuration before running live.

## License

ISC
