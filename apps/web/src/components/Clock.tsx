import { useEffect, useState } from 'react';
import { dualClock } from '@marsad/core';
import { t } from '../strings';

/**
 * ET with local time. `localClassName` can hide the local half where the bar is narrow; ET always shows, and the
 * accessible label always carries both.
 */
export function Clock({
  localZone,
  localClassName = '',
}: {
  localZone: string;
  localClassName?: string;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  const c = dualClock(now, localZone);
  return (
    <p className="text-sm whitespace-nowrap" aria-label={c.label}>
      <span className="font-medium">{c.et}</span> <span className="text-muted">{t.clock.et}</span>
      <span className={localClassName}>
        <span className="mx-2 text-line" aria-hidden="true">
          |
        </span>
        <span className="font-medium">{c.local}</span>{' '}
        <span className="text-muted">{t.clock.local}</span>
      </span>
    </p>
  );
}
