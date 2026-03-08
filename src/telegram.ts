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

export async function sendAlert(message: string): Promise<void> {
  const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    await axios.post(url, {
      chat_id: CONFIG.TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML',
      message_thread_id: CONFIG.TELEGRAM_THREAD_ID,
      disable_web_page_preview: true,
    });
    console.log(`Telegram alert sent: ${message.slice(0, 80)}...`);
  } catch (err) {
    console.error('Failed to send Telegram alert:', err);
  }
}

export function formatWhaleAlert(params: {
  wallet: string;
  marketTitle: string;
  positionUsd: number;
  outcome: string;
  conditionId: string;
}): string {
  const { wallet, marketTitle, positionUsd, outcome, conditionId } = params;
  const shortWallet = shortenWallet(wallet);
  const formattedUsd = positionUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  return [
    `🐋 <b>WHALE ALERT</b>`,
    ``,
    `<b>Market:</b> ${escapeHtml(marketTitle)}`,
    `<b>Wallet:</b> <code>${shortWallet}</code>`,
    `<b>Position:</b> ${formattedUsd}`,
    `<b>Outcome:</b> ${escapeHtml(outcome)}`,
    `<b>Market ID:</b> <code>${conditionId.slice(0, 10)}...</code>`,
    ``,
    `🔗 <a href="https://polymarket.com/profile/${wallet}">View Wallet</a>`,
  ].join('\n');
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
  const { label, wallet, marketTitle, outcome, oldValueUsd, newValueUsd, isNew } = params;
  const shortWallet = shortenWallet(wallet);
  const fmt = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  const lines = [
    `🎯 <b>SHARP MOVE</b>`,
    ``,
    `<b>Bettor:</b> ${escapeHtml(label)} (<code>${shortWallet}</code>)`,
    `<b>Market:</b> ${escapeHtml(marketTitle)}`,
    `<b>Outcome:</b> ${escapeHtml(outcome)}`,
  ];

  if (isNew) {
    lines.push(`<b>Action:</b> NEW position ${fmt(newValueUsd)}`);
  } else {
    const change = newValueUsd - oldValueUsd;
    lines.push(`<b>Action:</b> Added ${fmt(change)} (${fmt(oldValueUsd)} → ${fmt(newValueUsd)})`);
  }

  lines.push(``, `🔗 <a href="https://polymarket.com/profile/${wallet}">View Wallet</a>`);
  return lines.join('\n');
}

export function formatVolumeAlert(params: {
  marketTitle: string;
  conditionId: string;
  tradesLastHour: number;
  totalVolume: number;
}): string {
  const { marketTitle, conditionId, tradesLastHour, totalVolume } = params;
  const fmt = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  return [
    `📈 <b>VOLUME SPIKE</b>`,
    ``,
    `<b>Market:</b> ${escapeHtml(marketTitle)}`,
    `<b>Trades last hour:</b> ${tradesLastHour}`,
    `<b>Total volume:</b> ${fmt(totalVolume)}`,
    `<b>Market ID:</b> <code>${conditionId.slice(0, 10)}...</code>`,
  ].join('\n');
}
