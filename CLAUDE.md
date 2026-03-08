# Polymarket Whale Scanner

## Project Purpose
Scan Polymarket for whale positions (likely insiders) and track sharp bettors. Alert via Telegram.

## Architecture
- TypeScript/Node.js
- SQLite for persistence
- Runs as macOS LaunchAgent (every 5 minutes)
- Alerts to Telegram (chat: -1003883635253, thread_id: 3)

## Key APIs
- Positions: https://data-api.polymarket.com/positions?user=WALLET
- Markets: https://gamma-api.polymarket.com/markets  
- Activity: https://data-api.polymarket.com/activity?user=WALLET
- Telegram Bot Token: read from TELEGRAM_BOT_TOKEN env var

## Existing Code to Reference
- ~/Projects/polymarket-radar/ — has Polymarket API patterns
- ~/Projects/polymarket-copy-trading-bot/ — has wallet tracking logic
- ~/Projects/trading-dashboard/ — add scanner data here later

## Requirements
1. Whale detection: new wallets with large single-event positions (>$1000)
2. Sharp bettor tracking: configurable wallet list, monitor positions/changes
3. Volume anomaly detection on quiet markets
4. SQLite DB: wallet history, position snapshots, alert dedup
5. Telegram alerts: whale positions, sharp bettor moves
6. LaunchAgent plist for auto-start

## DrPufferfish
Find their wallet from Polymarket leaderboard. Add as first tracked sharp bettor.

## Principles
- Speed matters for insider detection — alert fast
- Dedup alerts — don't spam the same position
- chmod 600 all .env and .db files
