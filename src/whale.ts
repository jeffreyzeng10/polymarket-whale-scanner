import { fetchTopMarkets, fetchMarketTrades, fetchWalletPositions, sleep, Market, Trade } from './api';
import { hasAlertBeenSent, markAlertSent, recordWhaleDetection, getSharpWallets } from './db';
import { queueAlert, formatWhaleAlert } from './telegram';
import { CONFIG } from './config';

export class WhaleScanner {
  async scan(): Promise<void> {
    console.log('[WhaleScanner] Starting scan...');

    let markets: Market[];
    try {
      markets = await fetchTopMarkets(CONFIG.TOP_MARKETS_COUNT);
      console.log(`[WhaleScanner] Fetched ${markets.length} top markets`);
    } catch (err) {
      console.error('[WhaleScanner] Failed to fetch markets:', err);
      return;
    }

    // Get known sharp wallet addresses to skip them
    const knownWallets = new Set(getSharpWallets().map((w) => w.wallet.toLowerCase()));

    let whalesFound = 0;

    for (const market of markets) {
      try {
        await sleep(CONFIG.API_DELAY_MS);
        const trades = await fetchMarketTrades(market.conditionId, 50);

        if (!trades.length) continue;

        // Group BUY trades by maker
        const buysByMaker = new Map<string, { totalUsd: number; outcome: string; trades: Trade[] }>();

        for (const trade of trades) {
          const side = trade.side?.toUpperCase();
          if (side !== 'BUY' && side !== 'BUY_ORDER') continue;
          if (!trade.maker) continue;

          const makerLower = trade.maker.toLowerCase();
          const tradeUsd = trade.size * trade.price;

          if (!buysByMaker.has(makerLower)) {
            buysByMaker.set(makerLower, { totalUsd: 0, outcome: trade.outcome, trades: [] });
          }

          const entry = buysByMaker.get(makerLower)!;
          entry.totalUsd += tradeUsd;
          entry.trades.push(trade);
        }

        // Check each maker
        for (const [makerLower, data] of buysByMaker.entries()) {
          if (data.totalUsd < CONFIG.WHALE_MIN_BUY_USD) continue;
          if (knownWallets.has(makerLower)) continue;

          const alertKey = `whale:${makerLower}:${market.conditionId}`;
          if (hasAlertBeenSent(alertKey)) continue;

          // Alert!
          console.log(`[WhaleScanner] Whale found: ${makerLower} bought $${data.totalUsd.toFixed(2)} on ${market.title}`);

          const message = formatWhaleAlert({
            wallet: data.trades[0]?.maker || makerLower,
            marketTitle: market.title,
            positionUsd: data.totalUsd,
            outcome: data.outcome,
            conditionId: market.conditionId,
          });

          queueAlert('whale', message);
          markAlertSent(alertKey);
          recordWhaleDetection(
            data.trades[0]?.maker || makerLower,
            market.conditionId,
            market.title,
            data.totalUsd,
            data.outcome
          );

          whalesFound++;
        }
      } catch (err) {
        console.error(`[WhaleScanner] Error processing market ${market.conditionId}:`, err);
      }
    }

    console.log(`[WhaleScanner] Scan complete. ${whalesFound} whale alerts sent.`);
  }
}
