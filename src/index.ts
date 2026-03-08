import 'dotenv/config';
import { initDb, addSharpWallet, getSharpWallets } from './db';
import { fetchLeaderboard } from './api';
import { WhaleScanner } from './whale';
import { SharpScanner } from './sharp';
import { VolumeScanner } from './volume';
import { flushDigest } from './telegram';

import { CONFIG } from './config';

async function seedSharpWallets(): Promise<void> {
  console.log('[Seed] Seeding known sharp wallets...');
  
  // Always seed hardcoded known wallets first
  for (const { wallet, label } of CONFIG.KNOWN_SHARP_WALLETS) {
    addSharpWallet(wallet, label);
    console.log(`[Seed] Added known wallet: ${label} (${wallet})`);
  }

  // Try to find more from leaderboard
  try {
    console.log('[Seed] Scanning leaderboard for additional sharp bettors...');
    const entries = await fetchLeaderboard();
    
    for (const entry of entries) {
      const name = String(entry.name || entry.username || '');
      const wallet = String(entry.proxyWallet || entry.address || '');
      if (!wallet || wallet === '0x' || !name) continue;
      
      // Auto-add top 10 PnL traders as sharp wallets
      const rank = parseInt(String((entry as Record<string, unknown>).rank || '999'), 10);
      if (rank <= 10) {
        addSharpWallet(wallet, `${name} (Rank #${rank})`);
        console.log(`[Seed] Added leaderboard trader: ${name} (Rank #${rank})`);
      }
    }
  } catch (err) {
    console.warn('[Seed] Leaderboard fetch failed, using hardcoded wallets only:', (err as Error).message);
  }
}

async function main(): Promise<void> {
  const startTime = new Date();
  console.log(`\n=== Polymarket Whale Scanner ===`);
  console.log(`Started at: ${startTime.toISOString()}`);
  console.log(`================================\n`);

  // 1. Initialize database
  initDb();

  // 2. Seed sharp wallets (DrPufferfish + top leaderboard)
  await seedSharpWallets();

  // 3. Get sharp wallets from DB
  const sharpWallets = getSharpWallets();
  console.log(`\n[Main] Tracking ${sharpWallets.length} sharp wallet(s):`);
  for (const w of sharpWallets) {
    console.log(`  - ${w.label}: ${w.wallet}`);
  }

  // 4. Run scanners
  const whaleScanner = new WhaleScanner();
  const sharpScanner = new SharpScanner();
  const volumeScanner = new VolumeScanner();

  await whaleScanner.scan();
  await sharpScanner.scan(sharpWallets);
  await volumeScanner.scan();

  // Send all queued alerts as a single digest message
  await flushDigest();

  const elapsed = Date.now() - startTime.getTime();
  console.log(`\n=== Scan complete in ${(elapsed / 1000).toFixed(1)}s ===\n`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
