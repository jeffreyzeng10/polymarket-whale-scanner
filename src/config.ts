import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export const CONFIG = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',
  TELEGRAM_THREAD_ID: parseInt(process.env.TELEGRAM_THREAD_ID || '3', 10),
  PORTFOLIO_THREAD_ID: parseInt(process.env.PORTFOLIO_THREAD_ID || '3', 10),
  PORTFOLIO_WALLET: process.env.PORTFOLIO_WALLET || '0xC633f71c204fe0202703cc4aB8e4Ff66CcFF415A',
  DB_PATH: process.env.DB_PATH || 'data/whale-scanner.db',
  WHALE_MIN_BUY_USD: 1000,
  SHARP_MIN_POSITION_CHANGE_USD: 500,
  TOP_MARKETS_COUNT: 30,
  API_DELAY_MS: 300,
  DATA_API_BASE: 'https://data-api.polymarket.com',
  GAMMA_API_BASE: 'https://gamma-api.polymarket.com',
  SHARP_WALLETS: [] as string[],
  // Known sharp bettors — hardcoded as fallback
  KNOWN_SHARP_WALLETS: [
    { wallet: '0xdb27bf2ac5d428a9c63dbc914611036855a6c56e', label: 'DrPufferfish' },
  ] as { wallet: string; label: string }[],
};
