/**
 * Market-wide news for one UTC day (no ticker filter), for the geopolitical topic counts (ADR 0012). Confirmed on
 * 2026-11-25 with the project key: about 500 articles a day, mostly investment press (The Motley Fool, Zacks,
 * GlobeNewswire), pages of up to 1,000 with a `next_url` cursor.
 */
import type { HttpClient } from '../http.js';
import type { MassiveConfig } from './massive.js';
import { paged } from './massive-breadth.js';
import { parseNewsItems, type NewsArticle } from './massive-study.js';
import type { AdapterResult } from './result.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function nextDay(date: string): string {
  const t = Date.parse(`${date}T00:00:00Z`) + 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Every article published on `date` (UTC), oldest first. At most 10 pages (10,000 articles). */
export function fetchNewsDay(
  http: HttpClient,
  cfg: MassiveConfig,
  date: string,
): Promise<AdapterResult<NewsArticle[]>> {
  if (!DATE.test(date)) throw new RangeError('date must be YYYY-MM-DD');
  const path =
    `/v2/reference/news?published_utc.gte=${date}T00:00:00Z&published_utc.lt=${nextDay(date)}T00:00:00Z` +
    '&limit=1000&order=asc&sort=published_utc';
  return paged(http, cfg, path, '/v2/reference/news', parseNewsItems, 10);
}
