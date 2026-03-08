import axios from 'axios';
import { CONFIG } from './config';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function shortenWallet(wallet: string): string {
  if (wallet.length < 10) return wallet;
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Digest system: collect alerts, send as one message ----

interface AlertEntry {
  type: 'whale' | 'sharp' | 'volume';
  message: string;
}

const pendingAlerts: AlertEntry[] = [];

export function queueAlert(type: AlertEntry['type'], message: string): void {
  pendingAlerts.push({ type, message });
}

export async function flushDigest(): Promise<void> {
  if (pendingAlerts.length === 0) {
    console.log('[Telegram] No alerts to send this scan.');
    return;
  }

  const whales = pendingAlerts.filter(a => a.type === 'whale');
  const sharps = pendingAlerts.filter(a => a.type === 'sharp');
  const volumes = pendingAlerts.filter(a => a.type === 'volume');

  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });

  const sections: string[] = [];
  sections.push(`📡 <b>Polymarket Scanner Digest</b> — ${timeStr} EST`);
  sections.push('');

  if (whales.length > 0) {
    sections.push(`🐋 <b>${whales.length} Whale Alert${whales.length > 1 ? 's' : ''}</b>`);
    sections.push('');
    // Show up to 5 whale alerts in digest
    for (const w of whales.slice(0, 5)) {
      sections.push(w.message);
      sections.push('');
    }
    if (whales.length > 5) {
      sections.push(`<i>...and ${whales.length - 5} more whale alerts</i>`);
      sections.push('');
    }
  }

  if (sharps.length > 0) {
    sections.push(`🎯 <b>${sharps.length} Sharp Bettor Move${sharps.length > 1 ? 's' : ''}</b>`);
    sections.push('');
    for (const s of sharps.slice(0, 8)) {
      sections.push(s.message);
      sections.push('');
    }
    if (sharps.length > 8) {
      sections.push(`<i>...and ${sharps.length - 8} more sharp moves</i>`);
      sections.push('');
    }
  }

  if (volumes.length > 0) {
    sections.push(`📈 <b>${volumes.length} Volume Spike${volumes.length > 1 ? 's' : ''}</b>`);
    sections.push('');
    for (const v of volumes.slice(0, 3)) {
      sections.push(v.message);
      sections.push('');
    }
    if (volumes.length > 3) {
      sections.push(`<i>...and ${volumes.length - 3} more volume spikes</i>`);
      sections.push('');
    }
  }

  const digest = sections.join('\n').trim();

  // Telegram max message length is 4096 chars
  const truncated = digest.length > 4000 
    ? digest.slice(0, 3950) + '\n\n<i>...digest truncated (too many alerts)</i>'
    : digest;

  await sendMessage(truncated);

  // Clear pending
  pendingAlerts.length = 0;
  console.log(`[Telegram] Digest sent: ${whales.length} whales, ${sharps.length} sharps, ${volumes.length} volumes`);
}

async function sendMessage(text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    await axios.post(url, {
      chat_id: CONFIG.TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'HTML',
      message_thread_id: CONFIG.TELEGRAM_THREAD_ID,
      disable_web_page_preview: true,
    });
    console.log(`[Telegram] Message sent (${text.length} chars)`);
  } catch (err: unknown) {
    const axiosErr = err as { response?: { status: number; data?: { parameters?: { retry_after?: number } } } };
    if (axiosErr.response?.status === 429) {
      const retryAfter = axiosErr.response.data?.parameters?.retry_after || 10;
      console.warn(`[Telegram] Rate limited. Waiting ${retryAfter}s...`);
      await sleep(retryAfter * 1000);
      try {
        await axios.post(url, {
          chat_id: CONFIG.TELEGRAM_CHAT_ID,
          text,
          parse_mode: 'HTML',
          message_thread_id: CONFIG.TELEGRAM_THREAD_ID,
          disable_web_page_preview: true,
        });
        console.log(`[Telegram] Message sent (retry)`);
      } catch (retryErr) {
        console.error('[Telegram] Failed after retry:', retryErr);
      }
    } else {
      console.error('[Telegram] Failed to send:', err);
    }
  }
}

// Legacy single-alert sender (kept for backwards compat)
export async function sendAlert(message: string): Promise<void> {
  await sendMessage(message);
}

export function resetAlertCount(): void {
  pendingAlerts.length = 0;
}

// ---- Format functions (return compact digest-friendly strings) ----

export function formatWhaleAlert(params: {
  wallet: string;
  marketTitle: string;
  positionUsd: number;
  outcome: string;
  conditionId: string;
}): string {
  const { wallet, marketTitle, positionUsd, outcome } = params;
  const shortWallet = shortenWallet(wallet);
  const formattedUsd = positionUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  return `• <code>${shortWallet}</code> → <b>${escapeHtml(marketTitle)}</b> (${escapeHtml(outcome)}) — ${formattedUsd}`;
}

export function formatSharpAlert(params: {
  label: string;
  wallet: string;
  marketTitle: string;
  outcome: string;
  oldValueUsd: number;
  newValueUsd: number;
  isNew: boolean;
}): string {
  const { label, marketTitle, outcome, newValueUsd, oldValueUsd, isNew } = params;
  const fmt = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  if (isNew) {
    return `• <b>${escapeHtml(label)}</b> → NEW on <b>${escapeHtml(marketTitle)}</b> (${escapeHtml(outcome)}) — ${fmt(newValueUsd)}`;
  } else {
    const change = newValueUsd - oldValueUsd;
    return `• <b>${escapeHtml(label)}</b> → added ${fmt(change)} on <b>${escapeHtml(marketTitle)}</b> (${escapeHtml(outcome)})`;
  }
}

export function formatVolumeAlert(params: {
  marketTitle: string;
  conditionId: string;
  tradesLastHour: number;
  totalVolume: number;
}): string {
  const { marketTitle, tradesLastHour, totalVolume } = params;
  const fmt = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  return `• <b>${escapeHtml(marketTitle)}</b> — ${tradesLastHour} trades/hr, ${fmt(totalVolume)} total vol`;
}
