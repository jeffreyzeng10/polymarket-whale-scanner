import axios from 'axios';
import { CONFIG } from './config';
import { fetchWalletPositions, Position, sleep } from './api';
import { hasAlertBeenSent, markAlertSent, getDb } from './db';
import { sendPortfolioMessage, escapeHtml } from './telegram';

const USER_AGENT = 'polymarket-whale-scanner/1.0.0';
const ONE_HOUR = 3600000;

export class PortfolioMonitor {
  private readonly wallet: string;

  constructor() {
    this.wallet = CONFIG.PORTFOLIO_WALLET;
  }

  async scan(): Promise<void> {
    console.log(`\n[Portfolio] Scanning wallet ${this.wallet}...`);

    let positions: Position[];
    try {
      positions = await fetchWalletPositions(this.wallet);
    } catch (err) {
      console.error('[Portfolio] Failed to fetch positions:', (err as Error).message);
      return;
    }

    console.log(`[Portfolio] Found ${positions.length} positions`);

    // Save snapshot before checks so daily summary can reference it
    this.saveSnapshot(positions);

    // Check for unredeemed positions on resolved markets
    await this.checkUnredeemed(positions);

    // Send daily summary once per day after 9 AM EST
    await this.checkDailySummary(positions);
  }

  private async isMarketResolved(conditionId: string): Promise<boolean> {
    const db = getDb();

    // Check DB cache (1 hour TTL)
    const cached = db.prepare(
      'SELECT resolved, checked_at FROM market_resolution_cache WHERE condition_id = ?'
    ).get(conditionId) as { resolved: number; checked_at: number } | undefined;

    if (cached && Date.now() - cached.checked_at < ONE_HOUR) {
      return cached.resolved === 1;
    }

    // Fetch from CLOB API (Gamma condition_id filter is unreliable)
    try {
      await sleep(CONFIG.API_DELAY_MS);
      const resp = await axios.get(`https://clob.polymarket.com/markets/${conditionId}`, {
        timeout: 10000,
        headers: { 'User-Agent': USER_AGENT },
      });

      const market = resp.data;
      // Market is resolved when closed=true and no longer accepting orders
      const resolved = !!(market?.closed && market?.accepting_orders === false);

      db.prepare(
        'INSERT OR REPLACE INTO market_resolution_cache (condition_id, resolved, checked_at) VALUES (?, ?, ?)'
      ).run(conditionId, resolved ? 1 : 0, Date.now());

      return resolved;
    } catch (err) {
      console.warn(`[Portfolio] Failed to check resolution for ${conditionId}:`, (err as Error).message);
      return false;
    }
  }

  private async checkUnredeemed(positions: Position[]): Promise<void> {
    const db = getDb();

    for (const pos of positions) {
      if (!pos.conditionId) continue;
      // Skip positions with zero value — those are resolved losses, nothing to redeem
      if (!pos.currentValue || pos.currentValue <= 0) continue;

      const resolved = await this.isMarketResolved(pos.conditionId);
      if (!resolved) continue;

      const alertKey = `portfolio:redeem:${this.wallet}:${pos.conditionId}`;
      if (hasAlertBeenSent(alertKey)) continue;

      const title = pos.marketTitle || pos.title || pos.conditionId;
      const value = pos.currentValue.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 2,
      });

      const msg = `🔓 <b>Unredeemed position:</b> ${escapeHtml(title)} — ${escapeHtml(pos.outcome)} — ~${value}`;
      await sendPortfolioMessage(msg);
      markAlertSent(alertKey);

      db.prepare(
        'INSERT INTO portfolio_alerts (wallet, alert_type, condition_id, details, alerted_at) VALUES (?, ?, ?, ?, ?)'
      ).run(
        this.wallet,
        'unredeemed',
        pos.conditionId,
        JSON.stringify({ outcome: pos.outcome, value }),
        Date.now()
      );

      console.log(`[Portfolio] Alerted unredeemed: ${title}`);
    }
  }

  private saveSnapshot(positions: Position[]): void {
    const db = getDb();
    const totalValue = positions.reduce((sum, p) => sum + (p.currentValue || 0), 0);
    db.prepare(
      'INSERT INTO portfolio_snapshots (wallet, total_positions, total_value_usd, positions_json, snapshot_at) VALUES (?, ?, ?, ?, ?)'
    ).run(this.wallet, positions.length, totalValue, JSON.stringify(positions), Date.now());
  }

  private async checkDailySummary(positions: Position[]): Promise<void> {
    // Only send once per day, first scan at or after 9 AM EST
    const estHour = parseInt(
      new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/New_York' }),
      10
    );
    if (estHour < 9) return;

    const dateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD
    const dailyKey = `portfolio:daily:${dateStr}`;
    if (hasAlertBeenSent(dailyKey)) return;

    const db = getDb();
    const fmtUsd = (v: number) =>
      v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

    const totalValue = positions.reduce((sum, p) => sum + (p.currentValue || 0), 0);

    const lines: string[] = [];
    lines.push(`📊 <b>Daily Portfolio Summary</b> — ${dateStr}`);
    lines.push('');
    lines.push(`💰 Total Value: <b>${fmtUsd(totalValue)}</b>`);
    lines.push(`📋 Open Positions: <b>${positions.length}</b>`);

    // Big movers vs previous snapshot
    const prevSnap = db.prepare(
      'SELECT positions_json FROM portfolio_snapshots WHERE wallet = ? ORDER BY snapshot_at DESC LIMIT 1 OFFSET 1'
    ).get(this.wallet) as { positions_json: string } | undefined;

    if (prevSnap) {
      const prevPositions: Position[] = JSON.parse(prevSnap.positions_json);
      const prevMap = new Map(prevPositions.map(p => [`${p.conditionId}:${p.outcome}`, p]));

      const movers: { title: string; change: number; pct: number }[] = [];
      for (const pos of positions) {
        const prev = prevMap.get(`${pos.conditionId}:${pos.outcome}`);
        if (!prev || prev.currentValue === 0) continue;
        const change = pos.currentValue - prev.currentValue;
        const pct = (change / prev.currentValue) * 100;
        if (Math.abs(pct) >= 20) {
          movers.push({ title: pos.marketTitle || pos.title || pos.conditionId, change, pct });
        }
      }

      movers.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
      if (movers.length > 0) {
        lines.push('');
        lines.push('📈 <b>Big Movers (&gt;20%):</b>');
        for (const m of movers.slice(0, 5)) {
          const arrow = m.change >= 0 ? '▲' : '▼';
          lines.push(
            `  ${arrow} ${escapeHtml(m.title)}: ${m.pct >= 0 ? '+' : ''}${m.pct.toFixed(1)}% (${fmtUsd(m.change)})`
          );
        }
      }
    }

    // Unredeemed count reminder
    const unredeemedCount = (
      db.prepare(
        "SELECT COUNT(*) as cnt FROM portfolio_alerts WHERE wallet = ? AND alert_type = 'unredeemed'"
      ).get(this.wallet) as { cnt: number }
    )?.cnt || 0;

    if (unredeemedCount > 0) {
      lines.push('');
      lines.push(
        `🔓 <b>${unredeemedCount} unredeemed position${unredeemedCount > 1 ? 's' : ''}</b> — remember to redeem!`
      );
    }

    const msg = lines.join('\n');
    await sendPortfolioMessage(msg);
    markAlertSent(dailyKey);
    console.log(`[Portfolio] Daily summary sent for ${dateStr}`);
  }
}
