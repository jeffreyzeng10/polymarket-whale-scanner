# Polymarket Whale Scanner

Scans Polymarket for whale positions and sharp bettors. Tracks DrPufferfish and the top 10 PnL leaderboard wallets, sending alerts to the Trading topic in Clawdy Hub when significant activity is detected.

## Status
**LIVE** — runs every 5 minutes via LaunchAgent (`ai.clawdy.polymarket-whale-scanner`)

## Setup

```bash
npm install
npm run build
```

## Usage

```bash
# Dev mode (hot reload)
npm run dev

# Production (compiled)
npm start

# Daily summary report
npm run daily-summary
```

## LaunchAgent

The scanner runs automatically via macOS LaunchAgent:

```bash
# Check status
launchctl list | grep whale

# Load
launchctl load ~/Projects/polymarket-whale-scanner/com.jeffzeng.whale-scanner.plist

# Unload
launchctl unload ~/Projects/polymarket-whale-scanner/com.jeffzeng.whale-scanner.plist
```

## Tracked Wallets

- **DrPufferfish** — primary tracked whale
- **Top 10 PnL leaderboard** — scraped from Polymarket leaderboard on each run

## Alerts

Sends to Telegram: Clawdy Hub → Trading topic (thread `3`, chat `-1003883635253`)

Alert triggers:
- New position opened by a tracked wallet (size > threshold)
- Large position increase on an existing market
- Whale exit detected

## Architecture

- TypeScript / Node.js
- Polymarket CLOB API + Gamma API + Data API
- SQLite for position state tracking (`data/`)
- Logs to `logs/`
