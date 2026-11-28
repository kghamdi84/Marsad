import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '../Card';
import { Info } from '../Info';
import { TickerLink } from '../QuickLook';
import { loadHoldingsNews } from '../../lib/portfolio';
import { Source, ViewState, p, usePortfolio } from './shared';

const w = p.news;
const ALL = '';

const when = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

/**
 * Holdings news: stored articles that name a holding, with a ticker filter and a search over titles and
 * descriptions. Choosing one shows its stored description as plain text and links out. No images, no full text.
 */
export function NewsView() {
  const x = usePortfolio();
  const q = useQuery({
    queryKey: ['holdings-news', x.tickers],
    queryFn: () => loadHoldingsNews(x.tickers),
    enabled: x.tickers.length > 0,
  });
  const [ticker, setTicker] = useState(ALL);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const needle = search.trim().toLowerCase();
  const list = (q.data ?? []).filter(
    (a) =>
      (ticker === ALL || a.tickers.includes(ticker)) &&
      (needle === '' ||
        a.title.toLowerCase().includes(needle) ||
        (a.description ?? '').toLowerCase().includes(needle)),
  );
  const chosen = list.find((a) => a.id === open) ?? null;
  return (
    <Card id="portfolio-news-h" title={w.title} aside={<Info>{w.info}</Info>}>
      <ViewState x={x}>
        <div className="flex flex-wrap gap-2">
          <label className="flex flex-col gap-1 text-xs text-ink3">
            {w.filter}
            <select
              className="min-h-11 rounded-lg border border-line-strong bg-canvas px-2 text-sm text-ink"
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
            >
              <option value={ALL}>{w.allTickers}</option>
              {x.tickers.map((tk) => (
                <option key={tk} value={tk}>
                  {tk}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs text-ink3">
            {w.search}
            <input
              type="search"
              className="min-h-11 rounded-lg border border-line-strong bg-canvas px-2 text-sm text-ink"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        {q.isError && <p className="text-sm text-down">{q.error.message}</p>}
        {q.data && list.length === 0 && <p className="text-sm text-ink3">{w.none}</p>}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] items-start gap-3">
          <ul className="flex flex-col gap-1.5" aria-label={w.listAria}>
            {list.slice(0, 40).map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  aria-pressed={a.id === open}
                  onClick={() => setOpen(a.id)}
                  className={`flex min-h-11 w-full flex-col gap-0.5 rounded-lg border border-line px-3 py-2 text-start ${a.id === open ? 'bg-sub' : 'bg-elev'}`}
                >
                  <span className="text-sm font-medium text-ink">{a.title}</span>
                  <span className="text-xs text-ink3">
                    {a.publisher} {'·'} {when(a.publishedAt)} {'·'}{' '}
                    {a.tickers.slice(0, 6).join(', ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <section
            aria-label={w.paneAria}
            aria-live="polite"
            className="flex flex-col gap-2 rounded-[10px] border border-line bg-elev p-3"
          >
            {chosen ? (
              <>
                <h3 className="text-base font-semibold text-ink">{chosen.title}</h3>
                <p className="text-xs text-ink3">
                  {chosen.publisher} {'·'} {when(chosen.publishedAt)}
                </p>
                <p className="flex flex-wrap gap-2 text-xs">
                  {chosen.tickers.map((tk) => (
                    <TickerLink key={tk} ticker={tk} />
                  ))}
                </p>
                <p className="text-sm whitespace-pre-line text-ink2">
                  {chosen.description ?? w.noDescription}
                </p>
                <a
                  href={chosen.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="min-h-11 self-start py-2 text-sm text-link underline"
                >
                  {w.readAt(chosen.publisher)}
                </a>
              </>
            ) : (
              <p className="text-sm text-ink3">{w.choose}</p>
            )}
          </section>
        </div>
        <Source>{w.source}</Source>
      </ViewState>
    </Card>
  );
}
