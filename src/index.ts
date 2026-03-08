import 'dotenv/config';
import { initDb, addSharpWallet, getSharpWallets } from './db';
import { fetchLeaderboard } from './api';
import { WhaleScanner } from './whale';
import { SharpScanner } from './sharp';
import { VolumeScanner } from './volume';

// DrPufferfish placeholder — real wallet found via leaderboard fetch at startup
const DRPUFFERFISH_PLACEHOLDER = '0x0000000000000000000000000000000000000001';
const DRPUFFERFISH_LABEL = 'DrPufferfish (TODO: find real wallet)';

async function seedDrPufferfish(): Promise<void> {
  console.log('[Seed] Looking up DrPufferfish on leaderboard...');
  try {
    const entries = await fetchLeaderboard();
    let found = false;

    for (const entry of entries) {
      // Search all string fields for "puffer"
      const searchFields = [entry.name, entry.username, entry.pseudonym, entry.displayName as string | undefined];
      const matchesName = searchFields.some(
        (f) => typeof f === 'string' && f.toLowerCase().includes('puffer')
      );

      if (matchesName) {
        const wallet = String(entry.proxyWallet || entry.address || '');
        if (!wallet || wallet === '0x') continue;

        console.log(`[Seed] Found DrPufferfish! Wallet: ${wallet}`);
        addSharpWallet(wallet, 'DrPufferfish');
        found = true;
        break;
      }
    }

    if (!found) {
      console.log('[Seed] DrPufferfish not found in leaderboard top 100. Using placeholder.');
      addSharpWallet(DRPUFFERFISH_PLACEHOLDER, DRPUFFERFISH_LABEL);
    }
  } catch (err) {
    console.error('[Seed] Failed to fetch leaderboard:', err);
    console.log('[Seed] Adding DrPufferfish placeholder wallet.');
    addSharpWallet(DRPUFFERFISH_PLACEHOLDER, DRPUFFERFISH_LABEL);
  }
}

async function main(): Promise<void> {
  const startTime = new Date();
  console.log(`\n=== Polymarket Whale Scanner ===`);
  console.log(`Started at: ${startTime.toISOString()}`);
  console.log(`================================\n`);

  // 1. Initialize database
  initDb();

  // 2. Seed DrPufferfish wallet
  await seedDrPufferfish();

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

  const elapsed = Date.now() - startTime.getTime();
  console.log(`\n=== Scan complete in ${(elapsed / 1000).toFixed(1)}s ===\n`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
