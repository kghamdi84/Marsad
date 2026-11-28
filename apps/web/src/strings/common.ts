/**
 * Strings shared by every page.
 * Import `t` from `strings.ts`, not this module (ADR 0051).
 */

export const appName = 'Marsad' as const;

export const loading = 'Loading' as const;

export const common = { showDetails: 'Show details' } as const;

export const info = { label: 'About this data' } as const;

export const errors = { generic: 'Something went wrong.' } as const;
