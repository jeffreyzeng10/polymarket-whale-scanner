import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { CONFIG } from './config';

let db: Database.Database;

export function initDb(): void {
  const dbPath = path.resolve(process.cwd(), CONFIG.DB_PATH);
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS wallets (
      wallet TEXT PRIMARY KEY,
      label TEXT,
      added_at INTEGER,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS positions_snapshot (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      condition_id TEXT NOT NULL,
      outcome TEXT NOT NULL,
      size REAL,
      avg_price REAL,
      value_usd REAL,
      market_title TEXT,
      snapshot_at INTEGER,
      UNIQUE(wallet, condition_id, outcome)
    );

    CREATE TABLE IF NOT EXISTS alerts_sent (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_key TEXT UNIQUE,
      sent_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS whale_detections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT,
      condition_id TEXT,
      market_title TEXT,
      position_usd REAL,
      outcome TEXT,
      detected_at INTEGER
    );
  `);

  // chmod 600 the db file after creation
  try {
    fs.chmodSync(dbPath, 0o600);
  } catch {
    // ignore chmod errors
  }

  console.log(`DB initialized at ${dbPath}`);
}

export function getDb(): Database.Database {
  return db;
}

export interface SharpWallet {
  wallet: string;
  label: string;
}

export function getSharpWallets(): SharpWallet[] {
  return db.prepare('SELECT wallet, label FROM wallets WHERE active = 1').all() as SharpWallet[];
}

export function addSharpWallet(wallet: string, label: string): void {
  db.prepare(`
    INSERT OR IGNORE INTO wallets (wallet, label, added_at, active)
    VALUES (?, ?, ?, 1)
  `).run(wallet, label, Date.now());
}

export interface PositionSnapshot {
  wallet: string;
  condition_id: string;
  outcome: string;
  size: number;
  avg_price: number;
  value_usd: number;
  market_title: string;
  snapshot_at: number;
}

export function getPositionSnapshot(wallet: string, conditionId: string, outcome: string): PositionSnapshot | undefined {
  return db.prepare(`
    SELECT * FROM positions_snapshot
    WHERE wallet = ? AND condition_id = ? AND outcome = ?
  `).get(wallet, conditionId, outcome) as PositionSnapshot | undefined;
}

export function upsertPositionSnapshot(
  wallet: string,
  conditionId: string,
  outcome: string,
  size: number,
  avgPrice: number,
  valueUsd: number,
  marketTitle: string
): void {
  db.prepare(`
    INSERT INTO positions_snapshot (wallet, condition_id, outcome, size, avg_price, value_usd, market_title, snapshot_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(wallet, condition_id, outcome) DO UPDATE SET
      size = excluded.size,
      avg_price = excluded.avg_price,
      value_usd = excluded.value_usd,
      market_title = excluded.market_title,
      snapshot_at = excluded.snapshot_at
  `).run(wallet, conditionId, outcome, size, avgPrice, valueUsd, marketTitle, Date.now());
}

export function hasAlertBeenSent(key: string): boolean {
  const row = db.prepare('SELECT id FROM alerts_sent WHERE alert_key = ?').get(key);
  return !!row;
}

export function markAlertSent(key: string): void {
  db.prepare(`
    INSERT OR IGNORE INTO alerts_sent (alert_key, sent_at)
    VALUES (?, ?)
  `).run(key, Date.now());
}

export function recordWhaleDetection(
  wallet: string,
  conditionId: string,
  marketTitle: string,
  positionUsd: number,
  outcome: string
): void {
  db.prepare(`
    INSERT INTO whale_detections (wallet, condition_id, market_title, position_usd, outcome, detected_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(wallet, conditionId, marketTitle, positionUsd, outcome, Date.now());
}
