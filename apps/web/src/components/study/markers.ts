import type { ChartMarker } from '@marsad/core';
import { t } from '../../strings';

/**
 * The letter drawn on the chart for a marker (v2): E for a results 8-K (Item 2.02), F for any other 8-K, D dividend,
 * S split, H halt, A Marsad alert and B insider purchase. The full label is in the detail line and list beneath it.
 */
export function markerLetter(m: Pick<ChartMarker, 'kind' | 'results'>): string {
  return t.study.ui.markerLetters[m.results ? 'results' : m.kind] ?? '?';
}
