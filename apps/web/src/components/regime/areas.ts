/**
 * The two switchable areas of the squeezed Regime page and the summary rows' targets. Each view names the id of
 * its card heading, so a summary row can switch to the view, scroll to it and move focus there.
 */
export const RISK_VIEWS = ['recession', 'fearGreed', 'capitulation', 'breadth'] as const;
export const CONTEXT_VIEWS = ['study', 'rotation', 'geopolitics', 'quality', 'measures'] as const;

export type RiskView = (typeof RISK_VIEWS)[number];
export type ContextView = (typeof CONTEXT_VIEWS)[number];

export type Target =
  { area: 'why' } | { area: 'risk'; view: RiskView } | { area: 'context'; view: ContextView };

/** The id of each view's card heading (set by the cards themselves). */
export const HEADING_ID: Record<RiskView | ContextView, string> = {
  recession: 'recession',
  fearGreed: 'fear-greed',
  capitulation: 'capitulation',
  breadth: 'breadth',
  study: 'study',
  rotation: 'rotation',
  geopolitics: 'geopolitics',
  quality: 'quality',
  measures: 'volatility',
};

export const AREA_ID = { risk: 'regime-risk', context: 'regime-context' } as const;
export const WHY_ID = 'regime-why';
