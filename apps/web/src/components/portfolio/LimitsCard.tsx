import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LIMIT_RANGES,
  parseLimitInput,
  type LimitKey,
  type PortfolioLimits,
  type StoredLimits,
} from '@marsad/core';
import { Card } from '../Card';
import { Info } from '../Info';
import { Button, ErrorText } from '../ui';
import { loadPortfolioLimits, savePortfolioLimits } from '../../lib/settings';
import { dayMonthYear } from '../../lib/dates';
import { t } from '../../strings';

const f = t.portfolio.limits.form;
const KEYS: readonly LimitKey[] = [
  'largestPosition',
  'top5',
  'minCash',
  'portfolioBeta',
  'openRisk',
];

/** A stored value as it is typed: a percent for the share limits ("20" for 0.2), beta as a number. */
const shown = (k: LimitKey, v: number | null) =>
  v === null ? '' : k === 'portfolioBeta' ? String(v) : String(Math.round(v * 10000) / 100);

const field =
  'min-h-11 w-28 rounded-lg border bg-elev px-3 text-end text-[15px] text-ink tabular-nums';

/**
 * Portfolio limits in Settings (ADR 0048): this person's own limits for their book, stored in `portfolio_limits`.
 * The owner's row starts with the council's values (28 Nov 2026), a member's with none. Blank is "No limit set".
 * Checked on Save (the form does not rely on the browser's own validation), each problem named beside its box.
 */
export function LimitsCard() {
  const q = useQuery({ queryKey: ['portfolio-limits'], queryFn: loadPortfolioLimits });
  if (q.isError)
    return (
      <Card id="set-limits" title={f.title}>
        <ErrorText message={q.error.message} />
      </Card>
    );
  if (!q.isSuccess)
    return (
      <Card id="set-limits" title={f.title}>
        <p className="text-sm text-ink3">{t.loading}</p>
      </Card>
    );
  return <LimitsForm stored={q.data} />;
}

function LimitsForm({ stored }: { stored: StoredLimits | null }) {
  const qc = useQueryClient();
  const [text, setText] = useState<Record<LimitKey, string>>(
    () =>
      Object.fromEntries(KEYS.map((k) => [k, shown(k, stored?.limits[k] ?? null)])) as Record<
        LimitKey,
        string
      >,
  );
  const [errors, setErrors] = useState<Partial<Record<LimitKey, string>>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: savePortfolioLimits,
    onSuccess: () => {
      setMsg(f.saved);
      void qc.invalidateQueries({ queryKey: ['portfolio-limits'] });
    },
  });
  const source = t.portfolio.limits.source;
  return (
    <Card id="set-limits" title={f.title} aside={<Info>{f.intro}</Info>}>
      <form
        aria-label={f.label}
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setMsg(null);
          const next: Partial<PortfolioLimits> = {};
          const errs: Partial<Record<LimitKey, string>> = {};
          for (const k of KEYS) {
            const r = parseLimitInput(k, text[k]);
            if ('error' in r)
              errs[k] =
                r.error === 'number'
                  ? f.errNumber
                  : k === 'minCash'
                    ? f.errRangeCash
                    : f.errRange(k === 'portfolioBeta' ? String(LIMIT_RANGES[k].max) : '100');
            else next[k] = r.value;
          }
          setErrors(errs);
          if (Object.keys(errs).length > 0) {
            setMsg(f.invalid);
            return;
          }
          save.mutate(next as PortfolioLimits);
        }}
      >
        <div className="flex flex-col">
          {KEYS.map((k) => {
            const id = `limit-${k}`;
            const err = errors[k];
            return (
              <div
                key={k}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line py-2 last:border-b-0"
              >
                <label htmlFor={id} className="min-w-0 flex-1 text-sm text-ink2">
                  {f[k]}
                </label>
                <input
                  id={id}
                  inputMode="decimal"
                  value={text[k]}
                  placeholder={f.placeholder}
                  aria-invalid={err ? true : undefined}
                  aria-describedby={err ? `${id}-err` : undefined}
                  onChange={(e) => setText({ ...text, [k]: e.target.value })}
                  className={`${field} ${err ? 'border-crit' : 'border-line-strong'} placeholder:text-ink3`}
                />
                {err && (
                  <p id={`${id}-err`} className="w-full text-xs text-crit">
                    {err}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-xs text-ink3">{f.openRiskNote}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={save.isPending}>
            {f.save}
          </Button>
          <span className="text-xs text-ink3">
            {stored
              ? `${
                  stored.setBy === 'council'
                    ? source.council
                    : t.portfolio.limits.setByYou(dayMonthYear(stored.setOn))
                }. ${f.version(stored.version, dayMonthYear(stored.setOn))}`
              : f.none}
          </span>
        </div>
        {save.isError && <ErrorText message={save.error.message} />}
        {msg && (
          <p role="status" className="text-sm text-ink2">
            {msg}
          </p>
        )}
      </form>
    </Card>
  );
}
