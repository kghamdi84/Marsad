import { useState } from 'react';
import {
  DEFAULT_LOCAL_ZONE,
  describeEightK,
  disclosureLag,
  dualClock,
  etDate,
  formLabel,
} from '@marsad/core';
import { secUrl, type FilingRow, type StudyData } from '../../lib/study';
import { dayMonthYear } from '../../lib/dates';
import { t } from '../../strings';
import { panelTitle, tileClass } from './Panel';
import { Num, Pill, type Tone } from '../ui/kit';

const FIRST = 6;
const ui = t.study.ui;

/** 8-Ks in the warn tone, Form 4s neutral, everything else (10-K, 10-Q, proxies) in the up tone, as in the design. */
function formTone(form: string): Tone {
  if (form.startsWith('8-K')) return 'warn';
  if (form === '4' || form === '4/A' || form === '3' || form === '5') return 'neutral';
  return 'up';
}

function FilingTitle({ f }: { f: FilingRow }) {
  if (f.form === '8-K' || f.form === '8-K/A') {
    const d = describeEightK(f.items);
    const defaulted = d.items.some((i) => i.basis === 'marsad-default');
    return (
      <span className="flex flex-col gap-0.5">
        <ul className="list-none text-sm text-ink">
          {d.items.map((i) => (
            <li key={i.item} title={i.officialTitle}>
              Item {i.item}: {i.plain}
            </li>
          ))}
          {d.unknown.map((n) => (
            <li key={n}>Item {n}: not in the table</li>
          ))}
        </ul>
        <span className="text-xs text-ink3" title={defaulted ? t.study.marsadDefault : undefined}>
          {t.study.materiality[d.materiality]}
        </span>
      </span>
    );
  }
  return <span className="text-sm text-ink">{formLabel(f.form)}</span>;
}

/**
 * Filings and announcements (v2, a tab of the company area): the newest SEC filings as rows of form, what it says in plain words, when the SEC
 * accepted it (ET and local) and the form's reporting lag. The full list of up to 60 is one tap away.
 */
export function FilingsCard({ data }: { data: StudyData }) {
  const [all, setAll] = useState(false);
  const list = data.filings.slice(0, 60);
  const shown = all ? list : list.slice(0, FIRST);
  return (
    <section aria-labelledby="filings" className={tileClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="filings" className={panelTitle}>
          {ui.filingsCard.title}
        </h2>
        <span className="text-xs text-ink3">{ui.filingsCard.source}</span>
      </div>
      <p className="text-xs text-ink3">{t.study.filingsNote}</p>
      {list.length === 0 ? (
        <p className="text-sm text-ink3">{t.study.noFilings}</p>
      ) : (
        <>
          <ul className="flex flex-col">
            {shown.map((f) => {
              const lag = disclosureLag(f.form);
              const link = data.company ? secUrl(data.company.cik, f) : null;
              const accepted = f.acceptedAt ? new Date(f.acceptedAt) : null;
              const when = accepted
                ? `${dayMonthYear(etDate(accepted))} ${dualClock(accepted, DEFAULT_LOCAL_ZONE).label}`
                : dayMonthYear(f.filingDate);
              const form = f.form === '4' ? 'Form 4' : f.form;
              return (
                <li
                  key={f.accession}
                  className="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-2.5 border-t border-line py-2.5"
                >
                  {link ? (
                    <a
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-start justify-self-start pt-0.5"
                    >
                      <Pill tone={formTone(f.form)} className="font-semibold underline-offset-2">
                        {form}
                      </Pill>
                      <span className="sr-only">{t.study.viewOnSec}</span>
                    </a>
                  ) : (
                    <span className="justify-self-start pt-0.5">
                      <Pill tone={formTone(f.form)} className="font-semibold">
                        {form}
                      </Pill>
                    </span>
                  )}
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <FilingTitle f={f} />
                    <span className="text-xs text-ink3">
                      <Num>{when}</Num>
                    </span>
                    {lag && <span className="text-xs text-ink3">{lag.label}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          {list.length > FIRST && (
            <button
              type="button"
              aria-expanded={all}
              onClick={() => setAll(!all)}
              className="min-h-11 self-start rounded-lg border border-line-strong px-3 text-sm font-semibold text-ink"
            >
              {all ? ui.filingsCard.showFewer : ui.filingsCard.showAll(list.length)}
            </button>
          )}
        </>
      )}
    </section>
  );
}
