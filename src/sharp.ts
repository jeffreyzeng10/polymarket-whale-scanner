import { fetchWalletPositions, sleep } from './api';
import {
  getPositionSnapshot,
  upsertPositionSnapshot,
  hasAlertBeenSent,
  markAlertSent,
  SharpWallet,
} from './db';
import { sendAlert, formatSharpAlert } from './telegram';
import { CONFIG } from './config';

export class SharpScanner {
  async scan(sharpWallets: SharpWallet[]): Promise<void> {
    console.log(`[SharpScanner] Scanning ${sharpWallets.length} sharp wallets...`);

    if (!sharpWallets.length) {
      console.log('[SharpScanner] No sharp wallets configured, skipping.');
      return;
    }

    let alertsSent = 0;

    for (const { wallet, label } of sharpWallets) {
      try {
        await sleep(CONFIG.API_DELAY_MS);
        const positions = await fetchWalletPositions(wallet);

        console.log(`[SharpScanner] ${label} (${wallet.slice(0, 8)}...): ${positions.length} positions`);

        for (const position of positions) {
          if (!position.conditionId) continue;

          const { conditionId, outcome, size, avgPrice, currentValue, marketTitle } = position;
          const valueUsd = currentValue || size * avgPrice;

          const snapshot = getPositionSnapshot(wallet, conditionId, outcome);

          let shouldAlert = false;
          let isNew = false;
          let oldValueUsd = 0;

          if (!snapshot) {
            // New position
            if (valueUsd >= 200) {
              shouldAlert = true;
              isNew = true;
            }
          } else {
            // Check if size increased significantly
            const oldValue = snapshot.value_usd;
            const increase = valueUsd - oldValue;
            if (increase >= CONFIG.SHARP_MIN_POSITION_CHANGE_USD) {
              shouldAlert = true;
              isNew = false;
              oldValueUsd = oldValue;
            }
          }

          // Update snapshot regardless
          upsertPositionSnapshot(wallet, conditionId, outcome, size, avgPrice, valueUsd, marketTitle || '');

          if (shouldAlert) {
            const sizeRounded = Math.round(valueUsd / 100) * 100;
            const alertKey = `sharp:${wallet}:${conditionId}:${outcome}:${sizeRounded}`;

            if (hasAlertBeenSent(alertKey)) continue;

            const displayTitle = marketTitle || conditionId.slice(0, 20);

            console.log(
              `[SharpScanner] Alert: ${label} ${isNew ? 'opened' : 'increased'} position on ${displayTitle} ($${valueUsd.toFixed(2)})`
            );

            const message = formatSharpAlert({
              label,
              wallet,
              marketTitle: displayTitle,
              outcome,
              oldValueUsd,
              newValueUsd: valueUsd,
              isNew,
            });

            await sendAlert(message);
            markAlertSent(alertKey);
            alertsSent++;
            await sleep(500);
          }
        }
      } catch (err) {
        console.error(`[SharpScanner] Error scanning wallet ${wallet}:`, err);
      }
    }

    console.log(`[SharpScanner] Scan complete. ${alertsSent} sharp alerts sent.`);
  }
}
