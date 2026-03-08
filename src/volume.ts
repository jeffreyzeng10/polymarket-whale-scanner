import { fetchTopMarkets, fetchMarketTrades, sleep, Market } from './api';
import { hasAlertBeenSent, markAlertSent } from './db';
import { sendAlert, formatVolumeAlert } from './telegram';
import { CONFIG } from './config';

const ONE_HOUR_MS = 60 * 60 * 1000;
const TRADES_SPIKE_THRESHOLD = 20; // > 20 trades in last hour
const LOW_VOLUME_THRESHOLD = 10000; // < $10k total volume

export class VolumeScanner {
  async scan(): Promise<void> {
    console.log('[VolumeScanner] Starting scan...');

    let markets: Market[];
    try {
      markets = await fetchTopMarkets(CONFIG.TOP_MARKETS_COUNT);
    } catch (err) {
      console.error('[VolumeScanner] Failed to fetch markets:', err);
      return;
    }

    const nowMs = Date.now();
    const oneHourAgo = nowMs - ONE_HOUR_MS;
    let spikeCount = 0;

    for (const market of markets) {
      // Only check low-volume markets for anomalies
      if (market.volume >= LOW_VOLUME_THRESHOLD) continue;

      try {
        await sleep(CONFIG.API_DELAY_MS);
        const trades = await fetchMarketTrades(market.conditionId, 50);

        if (!trades.length) continue;

        // Count trades in the last hour
        const recentTrades = trades.filter((t) => {
          const tradeMs = t.timestamp > 1e12 ? t.timestamp : t.timestamp * 1000;
          return tradeMs >= oneHourAgo;
        });

        if (recentTrades.length >= TRADES_SPIKE_THRESHOLD) {
          const today = new Date().toISOString().slice(0, 10);
          const alertKey = `volume:${market.conditionId}:${today}`;

          if (hasAlertBeenSent(alertKey)) continue;

          console.log(
            `[VolumeScanner] Volume spike on "${market.title}": ${recentTrades.length} trades in last hour, total volume $${market.volume.toFixed(2)}`
          );

          const message = formatVolumeAlert({
            marketTitle: market.title,
            conditionId: market.conditionId,
            tradesLastHour: recentTrades.length,
            totalVolume: market.volume,
          });

          await sendAlert(message);
          markAlertSent(alertKey);
          spikeCount++;
          await sleep(500);
        }
      } catch (err) {
        console.error(`[VolumeScanner] Error processing market ${market.conditionId}:`, err);
      }
    }

    console.log(`[VolumeScanner] Scan complete. ${spikeCount} volume spike alerts sent.`);
  }
}
