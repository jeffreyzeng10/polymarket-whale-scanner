import 'dotenv/config';
import axios from 'axios';
import { initDb, getDb } from '../src/db';
import { escapeHtml, shortenWallet } from '../src/telegram';
import { CONFIG } from '../src/config';

// Daily summary always goes to the Trading topic (thread 3), not Alerts (thread 14)
const SUMMARY_THREAD_ID = 3;
const LOOKBACK_MS = 24 * 60 * 60 * 1000;

interface WhaleDetection {
  wallet: string;
  condition_id: string;
  market_title: string;
  position_usd: number;
  outcome: string;
  detected_at: number;
}

interface PositionRow {
  wallet: string;
  label: string;
  condition_id: string;
  outcome: string;
  value_usd: number;
  market_title: string;
}

interface WalletDetectionCount {
  wallet: string;
  count: number;
}

async function sendToTelegram(text: string, threadId: number): Promise<void> {
  const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    await axios.post(url, {
      chat_id: CONFIG.TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'HTML',
      message_thread_id: threadId,
      disable_web_page_preview: true,
    });
    console.log(`[DailySummary] Sent to Telegram (${text.length} chars, thread ${threadId})`);
  } catch (err: unknown) {
    const e = err as { response?: { status: number; data?: unknown } };
    if (e.response) {
      console.error('[DailySummary] Telegram error:', e.response.status, JSON.stringify(e.response.data));
    } else {
      console.error('[DailySummary] Telegram send failed:', err);
    }
    throw err;
  }
}

function fmt(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const threadArgIdx = args.indexOf('--thread-id');
  const threadId = threadArgIdx >= 0 ? parseInt(args[threadArgIdx + 1], 10) : SUMMARY_THREAD_ID;

  console.log(`[DailySummary] Starting... (dry-run=${dryRun}, thread=${threadId})`);

  initDb();
  const db = getDb();

  const now = Date.now();
  const since = now - LOOKBACK_MS;

  // 1. Whale detections in last 24h (sorted by USD desc)
  const whaleDetections = db.prepare(`
    SELECT wallet, condition_id, market_title, position_usd, outcome, detected_at
    FROM whale_detections
    WHERE detected_at >= ?
    ORDER BY position_usd DESC
  `).all(since) as WhaleDetection[];

  console.log(`[DailySummary] Whale detections (24h): ${whaleDetections.length}`);

  // 2. Sharp alert count in last 24h (via alerts_sent table)
  const sharpAlertCount = (db.prepare(`
    SELECT COUNT(*) as count FROM alerts_sent
    WHERE alert_key LIKE 'sharp:%' AND sent_at >= ?
  `).get(since) as { count: number }).count;

  console.log(`[DailySummary] Sharp alerts (24h): ${sharpAlertCount}`);

  // 3. Most active whale wallets in last 24h
  const mostActiveWallets = db.prepare(`
    SELECT wallet, COUNT(*) as count
    FROM whale_detections
    WHERE detected_at >= ?
    GROUP BY wallet
    ORDER BY count DESC
    LIMIT 5
  `).all(since) as WalletDetectionCount[];

  // 4. Current positions for all tracked wallets (joined with labels)
  const trackedPositions = db.prepare(`
    SELECT ps.wallet, COALESCE(w.label, ps.wallet) as label,
           ps.condition_id, ps.outcome, ps.value_usd, ps.market_title
    FROM positions_snapshot ps
    LEFT JOIN wallets w ON ps.wallet = w.wallet
    WHERE ps.value_usd > 0
    ORDER BY ps.wallet, ps.value_usd DESC
  `).all() as PositionRow[];

  console.log(`[DailySummary] Tracked positions loaded: ${trackedPositions.length}`);

  // Group positions by wallet
  const walletMap = new Map<string, { label: string; positions: PositionRow[] }>();
  for (const row of trackedPositions) {
    if (!walletMap.has(row.wallet)) {
      walletMap.set(row.wallet, { label: row.label, positions: [] });
    }
    walletMap.get(row.wallet)!.positions.push(row);
  }

  // Build message
  const totalAlerts = whaleDetections.length + sharpAlertCount;
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York',
  });

  const lines: string[] = [];
  lines.push(`📊 <b>Daily Whale Scanner Summary</b> — ${dateStr}`);
  lines.push('');

  if (totalAlerts === 0 && walletMap.size === 0) {
    lines.push('😴 <i>No whale or sharp activity in the last 24 hours and no tracked positions.</i>');
  } else {
    // Section 1: Alert totals
    lines.push('<b>Last 24h Activity</b>');
    lines.push(`• 🐋 Whale detections: <b>${whaleDetections.length}</b>`);
    lines.push(`• 🎯 Sharp moves: <b>${sharpAlertCount}</b>`);
    lines.push(`• Total alerts: <b>${totalAlerts}</b>`);
    lines.push('');

    // Section 2: Top 5 biggest whale positions
    if (whaleDetections.length > 0) {
      lines.push('<b>Top Whale Positions</b>');
      for (const d of whaleDetections.slice(0, 5)) {
        const short = shortenWallet(d.wallet);
        const title = escapeHtml(d.market_title || d.condition_id.slice(0, 30));
        const outcome = escapeHtml(d.outcome);
        lines.push(`• <code>${short}</code> — ${fmt(d.position_usd)} on <b>${title}</b> (${outcome})`);
      }
      if (whaleDetections.length > 5) {
        lines.push(`<i>...+${whaleDetections.length - 5} more whale detections</i>`);
      }
      lines.push('');
    }

    // Section 3: Most active wallets
    if (mostActiveWallets.length > 0) {
      lines.push('<b>Most Active Wallets</b>');
      for (const w of mostActiveWallets) {
        lines.push(`• <code>${shortenWallet(w.wallet)}</code> — ${w.count} detection${w.count > 1 ? 's' : ''}`);
      }
      lines.push('');
    }

    // Section 4: Tracked wallet portfolios
    if (walletMap.size > 0) {
      lines.push('<b>Tracked Wallet Portfolios</b>');
      for (const [wallet, { label, positions }] of walletMap) {
        const totalUsd = positions.reduce((sum, p) => sum + p.value_usd, 0);
        const top3 = positions.slice(0, 3); // already sorted desc
        lines.push('');
        lines.push(`👤 <b>${escapeHtml(label)}</b> <code>${shortenWallet(wallet)}</code>`);
        lines.push(`   ${positions.length} position${positions.length !== 1 ? 's' : ''} · ${fmt(totalUsd)} total`);
        for (const p of top3) {
          const title = escapeHtml(p.market_title || p.condition_id.slice(0, 25));
          lines.push(`   • ${title} (${escapeHtml(p.outcome)}) — ${fmt(p.value_usd)}`);
        }
        if (positions.length > 3) {
          lines.push(`   <i>+${positions.length - 3} more</i>`);
        }
      }
    }
  }

  let message = lines.join('\n').trim();

  // Truncate to Telegram limit
  if (message.length > 3800) {
    message = message.slice(0, 3750) + '\n\n<i>...summary truncated</i>';
  }

  console.log(`[DailySummary] Message preview (${message.length} chars):\n${'─'.repeat(60)}\n${message}\n${'─'.repeat(60)}`);

  if (dryRun) {
    console.log('[DailySummary] Dry run — skipping Telegram send.');
    return;
  }

  if (!CONFIG.TELEGRAM_BOT_TOKEN) {
    console.warn('[DailySummary] No TELEGRAM_BOT_TOKEN — skipping send.');
    return;
  }

  await sendToTelegram(message, threadId);
  console.log('[DailySummary] Done.');
}

main().catch((err) => {
  console.error('[DailySummary] Fatal error:', err);
  process.exit(1);
});
