// ============================================================
// WHALE ALERT INTEGRATION
// Monitors large on-chain transactions via Whale Alert API.
// Set WHALE_ALERT_API_KEY env var to activate.
// ============================================================

import { createLogger } from '../utils/constants';

const logger = createLogger('whale-alert');

const API_KEY  = process.env.WHALE_ALERT_API_KEY;
const BASE_URL = 'https://api.whale-alert.io/v1';
const MIN_USD  = 500_000; // minimum transaction value

export interface WhaleTransaction {
  id:          string;
  blockchain:  string;
  symbol:      string;
  amountUsd:   number;
  from:        { address: string; owner?: string; ownerType: string };
  to:          { address: string; owner?: string; ownerType: string };
  timestamp:   number;
  hash:        string;
}

let lastTimestamp = Math.floor(Date.now() / 1000) - 300; // last 5 min on start

export async function fetchWhaleTransactions(): Promise<WhaleTransaction[]> {
  if (!API_KEY) {
    logger.warn('WHALE_ALERT_API_KEY not set — whale tracking disabled');
    return [];
  }

  try {
    const url = `${BASE_URL}/transactions?api_key=${API_KEY}&min_value=${MIN_USD}&start=${lastTimestamp}&cursor=0&limit=100`;
    const res  = await fetch(url);
    if (!res.ok) {
      logger.error('Whale Alert API error', { status: res.status });
      return [];
    }

    const data = await res.json() as any;
    const txs: WhaleTransaction[] = (data.transactions ?? []).map((t: any) => ({
      id:         t.id,
      blockchain: t.blockchain,
      symbol:     (t.symbol ?? '').toUpperCase(),
      amountUsd:  t.amount_usd,
      from:       { address: t.from?.address ?? '', owner: t.from?.owner, ownerType: t.from?.owner_type ?? 'unknown' },
      to:         { address: t.to?.address   ?? '', owner: t.to?.owner,   ownerType: t.to?.owner_type   ?? 'unknown' },
      timestamp:  t.timestamp,
      hash:       t.hash ?? '',
    }));

    if (txs.length > 0) {
      lastTimestamp = Math.max(...txs.map(t => t.timestamp)) + 1;
      logger.info('Whale transactions fetched', { count: txs.length });
    }

    return txs;
  } catch (err: any) {
    logger.error('Failed to fetch whale transactions', { error: err.message });
    return [];
  }
}
