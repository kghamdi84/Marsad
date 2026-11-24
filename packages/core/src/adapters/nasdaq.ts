/**
 * Nasdaq Trader trade-halts adapter (https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts).
 * No authentication. The feed refreshes about once a minute and lists the current day's halts. Khaled
 * approved polling it on 2026-11-24; Marsad polls no faster than every 30 seconds and does not
 * redistribute it. The request carries a generic client name, not a personal identity.
 */
import { HttpClient } from '../http.js';
import { parseHaltsRss, type HaltsFeed } from '../halts.js';
import type { Sourced } from '../provenance.js';
import { failure, type AdapterResult } from './result.js';

export const HALTS_URL = 'https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts';

export interface NasdaqConfig {
  now: () => Date;
  url?: string;
}

export async function fetchHalts(
  http: HttpClient,
  cfg: NasdaqConfig,
): Promise<AdapterResult<HaltsFeed>> {
  const res = await http.get(cfg.url ?? HALTS_URL, {
    headers: { 'User-Agent': 'Marsad-personal-research', Accept: 'application/rss+xml, text/xml' },
  });
  if (!res.ok) return failure('Nasdaq Trader', res.kind, res.message);
  // A page that is not the RSS feed (an error page with HTTP 200, for example) must not read as "no halts".
  if (!/<rss[\s>]/.test(res.body) || !/<channel>/.test(res.body)) {
    return failure('Nasdaq Trader', 'invalid-response', 'response was not an RSS feed');
  }
  const feed = parseHaltsRss(res.body);
  if (feed.generatedAt === null)
    return failure('Nasdaq Trader', 'invalid-response', 'feed has no publication time');
  const data: Sourced<HaltsFeed> = {
    value: feed,
    provenance: {
      source: 'nasdaq_halts',
      endpoint: '/rss.aspx?feed=tradehalts',
      asOf: feed.generatedAt.toISOString(),
      fetchedAt: cfg.now().toISOString(),
      planTier: 'real-time',
    },
  };
  return { ok: true, data, latencyMs: res.latencyMs, fromCache: res.fromCache };
}
