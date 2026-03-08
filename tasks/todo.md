# Polymarket Whale Scanner - Build Checklist

## Files Created
- [x] package.json - dependencies (axios, better-sqlite3@12, dotenv, tsx, typescript)
- [x] tsconfig.json - ES2022 target, commonjs module
- [x] .env - Telegram bot token, chat ID, thread ID, DB path
- [x] .gitignore - excludes node_modules, dist, .env, *.db, logs
- [x] src/config.ts - CONFIG object with all constants
- [x] src/api.ts - Polymarket API functions with 3-retry exponential backoff
- [x] src/db.ts - SQLite schema (wallets, positions_snapshot, alerts_sent, whale_detections)
- [x] src/telegram.ts - Telegram sendAlert + formatWhaleAlert, formatSharpAlert, formatVolumeAlert
- [x] src/whale.ts - WhaleScanner (BUY trades > $1000 per market)
- [x] src/sharp.ts - SharpScanner (new positions > $200, size increases > $500)
- [x] src/volume.ts - VolumeScanner (> 20 trades/hour on < $10k volume markets)
- [x] src/index.ts - Main entry: init DB, seed DrPufferfish, run all 3 scanners
- [x] com.jeffzeng.whale-scanner.plist - LaunchAgent (5-min interval)
- [x] data/ directory created
- [x] logs/ directory created

## Setup Steps
- [x] npm install (used better-sqlite3@12 for Node 25 compatibility)
- [x] npm run build (TypeScript compiled to dist/)
- [x] Dry run: node dist/index.js — SUCCESS (20.4s, 30 markets fetched)
- [x] Plist copied to ~/Library/LaunchAgents/
- [x] chmod 600 .env
- [x] GitHub repo created and pushed

## Notes
- DrPufferfish leaderboard API (leaderboard-api.polymarket.com) DNS not resolving in dev env; falls back to placeholder wallet automatically
- better-sqlite3 needed v12+ for Node 25 support (native addon)
- Scanner fetches top 30 markets by volume, checks trades for BUY whale activity
- Alert dedup via alerts_sent table with unique alert keys
