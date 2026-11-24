import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { STARTING_STOCKS, CORE_ETFS, normalizeTicker } from '@marsad/core';
import { Button } from '../components/ui';
import { t } from '../strings';

const chip =
  'flex min-h-11 min-w-20 items-center justify-center rounded-sm border border-line bg-raised px-4 font-medium hover:border-focus';

export function Study() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  function open(e: FormEvent) {
    e.preventDefault();
    const ticker = normalizeTicker(text);
    if (!ticker) return setError(t.study.badTicker(text));
    setError(null);
    void navigate({ to: '/study/$ticker', params: { ticker } });
  }

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-xl font-semibold">{t.study.title}</h1>
      <p className="text-muted">{t.study.intro}</p>
      <ul className="flex flex-wrap gap-2" aria-label={t.study.title}>
        {STARTING_STOCKS.map((tk) => (
          <li key={tk}>
            <Link to="/study/$ticker" params={{ ticker: tk }} className={chip}>
              {tk}
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted">{t.study.etfs}</p>
      <ul className="flex flex-wrap gap-2">
        {CORE_ETFS.map((tk) => (
          <li key={tk}>
            <Link to="/study/$ticker" params={{ ticker: tk }} className={chip}>
              {tk}
            </Link>
          </li>
        ))}
      </ul>
      <form onSubmit={open} className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="ticker" className="text-sm text-muted">
            {t.study.openLabel}
          </label>
          <input
            id="ticker"
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="min-h-11 w-40 rounded-sm border border-line bg-bg px-3 text-lg uppercase text-fg"
          />
        </div>
        <Button type="submit">{t.study.open}</Button>
      </form>
      {error && (
        <p role="alert" className="text-down">
          {error}
        </p>
      )}
    </section>
  );
}
