import axios, { AxiosError } from 'axios';
import { CONFIG } from './config';

const USER_AGENT = 'polymarket-whale-scanner/1.0.0';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === attempts - 1) throw err;
      const delay = Math.pow(2, i) * 1000;
      console.warn(`Request failed, retrying in ${delay}ms... (attempt ${i + 1}/${attempts})`);
      await sleep(delay);
    }
  }
  throw new Error('All retry attempts failed');
}

export interface Market {
  conditionId: string;
  slug: string;
  title: string;
  volume: number;
}

export interface Trade {
  id: string;
  maker: string;
  taker: string;
  conditionId: string;
  outcome: string;
  side: string;
  size: number;
  price: number;
  timestamp: number;
  marketTitle?: string;
}

export interface Position {
  conditionId: string;
  outcome: string;
  size: number;
  avgPrice: number;
  currentValue: number;
  marketTitle?: string;
  title?: string;
}

export interface LeaderboardEntry {
  name?: string;
  username?: string;
  proxyWallet?: string;
  address?: string;
  pseudonym?: string;
  [key: string]: unknown;
}

export async function fetchTopMarkets(limit: number = CONFIG.TOP_MARKETS_COUNT): Promise<Market[]> {
  return withRetry(async () => {
    const resp = await axios.get(`${CONFIG.GAMMA_API_BASE}/events`, {
      params: { active: true, limit, order: 'volume', ascending: false },
      timeout: 10000,
      headers: { 'User-Agent': USER_AGENT },
    });

    const data = resp.data;
    const events: Market[] = [];

    const items = Array.isArray(data) ? data : data.data || data.events || [];
    for (const event of items) {
      // Events may have multiple markets — use first conditionId
      const markets = event.markets || [];
      const conditionId = markets[0]?.conditionId || event.conditionId || '';
      if (!conditionId) continue;

      events.push({
        conditionId,
        slug: event.slug || '',
        title: event.title || event.question || '',
        volume: parseFloat(event.volume || event.volumeNum || '0'),
      });
    }

    return events;
  });
}

export async function fetchMarketTrades(conditionId: string, limit = 50): Promise<Trade[]> {
  return withRetry(async () => {
    const resp = await axios.get(`${CONFIG.DATA_API_BASE}/trades`, {
      params: { market: conditionId, limit },
      timeout: 10000,
      headers: { 'User-Agent': USER_AGENT },
    });

    const data = Array.isArray(resp.data) ? resp.data : resp.data.data || [];
    return data.map((t: Record<string, unknown>) => ({
      id: String(t.id || t.transactionHash || ''),
      maker: String(t.maker || t.user || ''),
      taker: String(t.taker || ''),
      conditionId: String(t.conditionId || t.market || conditionId),
      outcome: String(t.outcome || t.outcomeIndex || ''),
      side: String(t.side || t.type || ''),
      size: parseFloat(String(t.size || t.amount || '0')),
      price: parseFloat(String(t.price || '0')),
      timestamp: parseInt(String(t.timestamp || t.createdAt || '0'), 10),
    }));
  });
}

export async function fetchWalletPositions(wallet: string): Promise<Position[]> {
  return withRetry(async () => {
    const resp = await axios.get(`${CONFIG.DATA_API_BASE}/positions`, {
      params: { user: wallet },
      timeout: 10000,
      headers: { 'User-Agent': USER_AGENT },
    });

    const data = Array.isArray(resp.data) ? resp.data : resp.data.data || [];
    return data.map((p: Record<string, unknown>) => ({
      conditionId: String(p.conditionId || p.market || ''),
      outcome: String(p.outcome || p.outcomeIndex || ''),
      size: parseFloat(String(p.size || p.amount || '0')),
      avgPrice: parseFloat(String(p.avgPrice || p.averagePrice || '0')),
      currentValue: parseFloat(String(p.currentValue || p.value || '0')),
      marketTitle: String(p.title || p.market_title || p.question || ''),
    }));
  });
}

export async function fetchWalletActivity(wallet: string, limit = 50): Promise<Trade[]> {
  return withRetry(async () => {
    const resp = await axios.get(`${CONFIG.DATA_API_BASE}/activity`, {
      params: { user: wallet, type: 'TRADE', limit },
      timeout: 10000,
      headers: { 'User-Agent': USER_AGENT },
    });

    const data = Array.isArray(resp.data) ? resp.data : resp.data.data || [];
    return data.map((t: Record<string, unknown>) => ({
      id: String(t.id || t.transactionHash || ''),
      maker: wallet,
      taker: '',
      conditionId: String(t.conditionId || t.market || ''),
      outcome: String(t.outcome || t.outcomeIndex || ''),
      side: String(t.side || t.type || ''),
      size: parseFloat(String(t.size || t.amount || '0')),
      price: parseFloat(String(t.price || '0')),
      timestamp: parseInt(String(t.timestamp || t.createdAt || '0'), 10),
      marketTitle: String(t.title || t.market_title || t.question || ''),
    }));
  });
}

export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  return withRetry(async () => {
    const resp = await axios.get('https://data-api.polymarket.com/v1/leaderboard', {
      params: { timePeriod: 'ALL', orderBy: 'PNL', limit: 50 },
      timeout: 10000,
      headers: { 'User-Agent': USER_AGENT },
    });

    const data = Array.isArray(resp.data) ? resp.data : resp.data.data || resp.data.leaderboard || [];
    return data.map((entry: Record<string, unknown>) => ({
      ...entry,
      name: entry.userName || entry.name || '',
      username: entry.userName || entry.username || '',
      proxyWallet: entry.proxyWallet || entry.address || '',
      address: entry.proxyWallet || entry.address || '',
    })) as LeaderboardEntry[];
  });
}
