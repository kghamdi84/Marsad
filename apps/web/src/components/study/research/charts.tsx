/**
 * Small inline SVG charts for the research area. Colours come from theme tokens through `currentColor`, so both
 * themes work; each chart has a text label, and the numbers it draws are also in a table or a line beside it.
 */
import { toFixedHalfUp } from '@marsad/core';

const W = 640;

function scale(lo: number, hi: number, top: number, bottom: number) {
  const span = hi - lo || 1;
  return (v: number) => bottom - ((v - lo) / span) * (bottom - top);
}

/** Lines over a shared x index; null breaks a line. A dashed series also differs in pattern, not only colour. */
export function LineChart({
  label,
  series,
  height = 200,
  zero = false,
  format = (v: number) => toFixedHalfUp(v, 1),
}: {
  label: string;
  series: readonly { name: string; values: readonly (number | null)[]; className: string; dashed?: boolean }[];
  height?: number;
  zero?: boolean;
  format?: (v: number) => string;
}) {
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  if (all.length < 2) return null;
  let lo = Math.min(...all, ...(zero ? [0] : []));
  let hi = Math.max(...all, ...(zero ? [0] : []));
  const pad = (hi - lo) * 0.08 || 1;
  lo -= pad;
  hi += pad;
  const left = 8;
  const right = W - 64;
  const n = Math.max(...series.map((s) => s.values.length));
  const x = (i: number) => left + (n <= 1 ? 0 : (i / (n - 1)) * (right - left));
  const y = scale(lo, hi, 10, height - 10);
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${W} ${height}`} className="h-auto w-full">
      {zero && (
        <line x1={left} x2={right} y1={y(0)} y2={y(0)} className="text-line-strong" stroke="currentColor" strokeWidth={1} />
      )}
      {series.map((s) => {
        let d = '';
        let pen = false;
        s.values.forEach((v, i) => {
          if (v === null) {
            pen = false;
            return;
          }
          d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
          pen = true;
        });
        const lastI = s.values.findLastIndex((v) => v !== null);
        const lastV = lastI >= 0 ? (s.values[lastI] as number) : null;
        return (
          <g key={s.name} className={s.className}>
            <path
              d={d}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeDasharray={s.dashed ? '6 4' : undefined}
              strokeLinejoin="round"
            />
            {lastV !== null && (
              <text x={x(lastI) + 6} y={y(lastV) + 4} fontSize={12} fill="currentColor">
                {`${s.name} ${format(lastV)}`}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** The past closes, then dashed lines from the last close to the high, average and low targets 12 months out. */
export function TargetChart({
  label,
  closes,
  targets,
}: {
  label: string;
  closes: readonly number[];
  targets: readonly { name: string; value: number; className: string }[];
}) {
  if (closes.length < 2) return null;
  const H = 220;
  const all = [...closes, ...targets.map((t) => t.value)];
  const lo = Math.min(...all) * 0.95;
  const hi = Math.max(...all) * 1.05;
  const y = scale(lo, hi, 12, H - 12);
  const histEnd = W * 0.62;
  const futEnd = W - 120;
  const x = (i: number) => 8 + (i / (closes.length - 1)) * (histEnd - 8);
  const last = closes.at(-1) as number;
  const d = closes.map((c, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(c).toFixed(1)}`).join(' ');
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
      <line x1={histEnd} x2={histEnd} y1={8} y2={H - 8} className="text-line" stroke="currentColor" strokeDasharray="2 4" />
      <path d={d} fill="none" stroke="currentColor" strokeWidth={2} className="text-ink2" />
      {targets.map((t) => (
        <g key={t.name} className={t.className}>
          <line
            x1={histEnd}
            y1={y(last)}
            x2={futEnd}
            y2={y(t.value)}
            stroke="currentColor"
            strokeWidth={2}
            strokeDasharray="6 4"
          />
          <circle cx={futEnd} cy={y(t.value)} r={3.5} fill="currentColor" />
          <text x={futEnd + 8} y={y(t.value) + 4} fontSize={12} fill="currentColor">
            {`${t.name} $${toFixedHalfUp(t.value, 2)}`}
          </text>
        </g>
      ))}
    </svg>
  );
}

export interface BarGroup {
  label: string;
  values: readonly (number | null)[];
}

/**
 * Bars by group, side by side or stacked, with an optional line on a second axis. Negative values hang below the
 * zero line. Series differ by fill and are named in the legend.
 */
export function BarChart({
  label,
  groups,
  series,
  stacked = false,
  line,
  height = 200,
  format = (v: number) => toFixedHalfUp(v, 2),
}: {
  label: string;
  groups: readonly BarGroup[];
  series: readonly { name: string; className: string }[];
  stacked?: boolean;
  line?: { name: string; values: readonly (number | null)[]; className: string };
  height?: number;
  format?: (v: number) => string;
}) {
  if (groups.length === 0) return null;
  const totals = groups.map((g) => (stacked ? [g.values.reduce<number>((s, v) => s + (v ?? 0), 0)] : g.values.map((v) => v ?? 0)));
  const flat = totals.flat();
  const lo = Math.min(0, ...flat);
  const hi = Math.max(0, ...flat);
  const top = 16;
  const bottom = height - 22;
  const y = scale(lo, hi, top, bottom);
  const left = 8;
  const right = line ? W - 56 : W - 8;
  const slot = (right - left) / groups.length;
  const barW = stacked ? slot * 0.6 : (slot * 0.7) / Math.max(1, series.length);
  const lv = line ? line.values.filter((v): v is number => v !== null) : [];
  const ly = lv.length ? scale(Math.min(...lv) * 0.98, Math.max(...lv) * 1.02, top, bottom) : null;
  const every = Math.ceil(groups.length / 8);
  return (
    <figure className="flex flex-col gap-1">
      <svg role="img" aria-label={label} viewBox={`0 0 ${W} ${height}`} className="h-auto w-full">
        <line x1={left} x2={right} y1={y(0)} y2={y(0)} className="text-line-strong" stroke="currentColor" />
        {groups.map((g, gi) => {
          const x0 = left + gi * slot + (slot - (stacked ? barW : barW * series.length)) / 2;
          let acc = 0;
          return (
            <g key={`${g.label}-${gi}`}>
              {g.values.map((v, si) => {
                if (v === null) return null;
                const s = series[si];
                if (!s) return null;
                const from = stacked ? acc : 0;
                const to = stacked ? acc + v : v;
                if (stacked) acc += v;
                const yTop = y(Math.max(from, to));
                const h = Math.abs(y(from) - y(to));
                return (
                  <rect
                    key={si}
                    x={stacked ? x0 : x0 + si * barW}
                    y={yTop}
                    width={Math.max(1, barW - 1)}
                    height={Math.max(h, v === 0 ? 0 : 1)}
                    className={s.className}
                    fill="currentColor"
                  />
                );
              })}
              {gi % every === 0 && (
                <text x={left + gi * slot + slot / 2} y={height - 6} fontSize={11} textAnchor="middle" className="text-ink3" fill="currentColor">
                  {g.label}
                </text>
              )}
            </g>
          );
        })}
        {line && ly && (
          <g className={line.className}>
            <path
              d={line.values
                .map((v, i) => (v === null ? '' : `${i && line.values[i - 1] !== null ? 'L' : 'M'}${(left + i * slot + slot / 2).toFixed(1)} ${ly(v).toFixed(1)}`))
                .join(' ')}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeDasharray="5 3"
            />
            {lv.length > 0 && (
              <text x={right + 4} y={ly(lv.at(-1) as number) + 4} fontSize={11} fill="currentColor">
                {format(lv.at(-1) as number)}
              </text>
            )}
          </g>
        )}
      </svg>
      <figcaption className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink3">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1">
            <span aria-hidden="true" className={`inline-block size-2.5 rounded-sm bg-current ${s.className}`} />
            {s.name}
          </span>
        ))}
        {line && (
          <span className="inline-flex items-center gap-1">
            <span aria-hidden="true" className={`inline-block h-0.5 w-3 bg-current ${line.className}`} />
            {line.name}
          </span>
        )}
      </figcaption>
    </figure>
  );
}
