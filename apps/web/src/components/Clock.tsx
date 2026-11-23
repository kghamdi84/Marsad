import { useEffect, useState } from 'react';
import { dualClock } from '@marsad/core';
import { t } from '../strings';

export function Clock({ localZone }: { localZone: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  const c = dualClock(now, localZone);
  return (
    <p className="text-sm" aria-label={c.label}>
      <span className="font-medium">{c.et}</span> <span className="text-muted">{t.clock.et}</span>
      <span className="mx-2 text-line" aria-hidden="true">
        |
      </span>
      <span className="font-medium">{c.local}</span>{' '}
      <span className="text-muted">{t.clock.local}</span>
    </p>
  );
}
