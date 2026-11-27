import { describe, expect, it } from 'vitest';
import { EOD_STALE_MS, QUOTE_POLL_MS, quotePollInterval } from './refresh';

describe('refresh rules (ADR 0042)', () => {
  it('polls quotes once a minute only in the regular session', () => {
    expect(quotePollInterval('regular')).toBe(QUOTE_POLL_MS);
    for (const s of ['pre-market', 'after-hours', 'closed', null, undefined])
      expect(quotePollInterval(s)).toBe(false);
  });

  it('keeps end-of-day data for 30 minutes', () => {
    expect(EOD_STALE_MS).toBe(1_800_000);
  });
});
