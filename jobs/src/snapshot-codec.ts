/**
 * Compact storage of one session's market snapshot (ADR 0010): gzip of {t: tickers, c: closes, v: volumes}, base64.
 * About 5,000 tickers a day at USD 1 million or more of dollar volume.
 */
import { gunzipSync, gzipSync } from 'node:zlib';
import type { MarketRow } from '@marsad/core';

export const SNAPSHOT_ENCODING = 'gzip-base64-json-v1';
/** Tickers below this dollar volume on the day are not stored: a universe member trades far more every day. */
export const MIN_SNAPSHOT_DOLLAR_VOLUME = 1_000_000;

export function encodeSnapshot(rows: readonly MarketRow[]): { payload: string; tickers: number } {
  const kept = rows.filter((r) => r.close > 0 && r.close * r.volume >= MIN_SNAPSHOT_DOLLAR_VOLUME);
  const body = JSON.stringify({
    t: kept.map((r) => r.ticker),
    c: kept.map((r) => r.close),
    v: kept.map((r) => r.volume),
  });
  return { payload: gzipSync(Buffer.from(body, 'utf8')).toString('base64'), tickers: kept.length };
}

export function decodeSnapshot(payload: string): MarketRow[] {
  if (payload === '') return [];
  const j = JSON.parse(gunzipSync(Buffer.from(payload, 'base64')).toString('utf8')) as {
    t: string[];
    c: number[];
    v: number[];
  };
  if (j.t.length !== j.c.length || j.t.length !== j.v.length)
    throw new Error('snapshot columns have different lengths');
  return j.t.map((ticker, i) => ({ ticker, close: j.c[i] as number, volume: j.v[i] as number }));
}

/** Ticker lists as of a date, compressed the same way. */
export function encodeList(list: { cs: readonly string[]; etf: readonly string[] }): string {
  return gzipSync(Buffer.from(JSON.stringify(list), 'utf8')).toString('base64');
}
export function decodeList(payload: string): { cs: string[]; etf: string[] } {
  return JSON.parse(gunzipSync(Buffer.from(payload, 'base64')).toString('utf8')) as {
    cs: string[];
    etf: string[];
  };
}
