/**
 * Strings shared by every page.
 * Import `t` from `strings.ts`, not this module (ADR 0051).
 */

export const appName = 'Marsad' as const;

export const loading = 'Loading' as const;

export const common = {
  showDetails: 'Show details',
  /** AI text (ADR 0007): what every AI panel says about its sources and model. */
  ai: {
    sources: 'Sources cited',
    filed: (date: string) => `filed ${date}`,
    openFiling: 'Filing on SEC',
    asOf: (date: string, model: string) => `As of ${date} · ${model}`,
    models: {
      'claude-sonnet-5-5': 'Claude Sonnet 5.5',
      'claude-opus-5-5': 'Claude Opus 5.5',
      'claude-haiku-5-5': 'Claude Haiku 5.5',
      'claude-sonnet-5': 'Claude Sonnet 5',
      'claude-opus-5': 'Claude Opus 5',
    } as Record<string, string>,
    reasons: {
      'cost-cap': 'the daily or monthly AI spending cap was reached',
      refusal: 'the model declined to write it',
      'verification-failed': 'its figures did not match the filings, twice',
      'generation-failed': 'the AI call failed',
    } as Record<string, string>,
    unknownReason: 'the AI text was not available',
  },
} as const;

export const info = { label: 'About this data' } as const;

export const errors = { generic: 'Something went wrong.' } as const;
