import { useEffect } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useRemembered } from '../components/Card';

/**
 * A route's `validateSearch` for string parameters such as `view` and `ticker`: each named key is kept when it is a
 * non-empty string (a number-looking value is kept as its text), and everything else is dropped. Which values are
 * allowed is the page's business: `useView` falls back when the value is not one of its views.
 */
export function stringSearch<K extends string>(...keys: K[]) {
  return (raw: Record<string, unknown>): { [P in K]?: string } => {
    const out: { [P in K]?: string } = {};
    for (const k of keys) {
      const v = raw[k];
      if (typeof v === 'string' && v.trim() !== '') out[k] = v.trim();
      else if (typeof v === 'number' && Number.isFinite(v)) out[k] = String(v);
    }
    return out;
  };
}

/**
 * The view of a page with switchable areas (ADR 0048: every view has a URL). The `?view=` parameter wins when it
 * names one of `allowed`; otherwise the choice remembered on this device, then `fallback`. Choosing a view writes
 * both, replacing the history entry (switching views is not a new page), and keeps any hash. A view that arrives
 * by URL is remembered too, so the next plain visit opens where Khaled left off.
 */
export function useView<K extends string>(storageKey: string, allowed: readonly K[], fallback: K) {
  const search: { view?: unknown } = useSearch({ strict: false });
  const [stored, setStored] = useRemembered(storageKey, allowed, fallback);
  const navigate = useNavigate();
  const fromUrl =
    typeof search.view === 'string' && (allowed as readonly string[]).includes(search.view)
      ? (search.view as K)
      : null;
  useEffect(() => {
    if (fromUrl !== null && fromUrl !== stored) setStored(fromUrl);
    // Only the URL drives this; `setStored` is a fresh function each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromUrl, stored]);
  const set = (k: K) => {
    setStored(k);
    void navigate({
      to: '.',
      search: (prev: Record<string, unknown>) => ({ ...prev, view: k }),
      hash: true,
      replace: true,
      resetScroll: false,
    });
  };
  return [fromUrl ?? stored, set] as const;
}
