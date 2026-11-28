/**
 * Every user-visible string lives under `strings/`, one module per area, gathered here so pages keep importing
 * `t` from this file and an Arabic (right-to-left) option can be added later by swapping the modules. The split
 * keeps parallel work on different pages from colliding in one file (ADR 0051).
 */
import { appName, loading, common, info, errors } from './strings/common';
import { configMissing, signIn, mfa } from './strings/auth';
import { nav, pages, footer, clock, shell } from './strings/shell';
import { watch, watchlist, trader, calendar } from './strings/watch';
import { journal } from './strings/journal';
import { portfolio } from './strings/portfolio';
import { alerts } from './strings/alerts';
import { lab } from './strings/lab';
import { quickLook } from './strings/quickLook';
import { study } from './strings/study';
import { regime } from './strings/regime';
import { markets } from './strings/markets';
import { screener } from './strings/screener';
import { status } from './strings/status';
import { settings } from './strings/settings';
import { ask } from './strings/ask';

export const t = {
  appName,
  configMissing,
  loading,
  common,
  signIn,
  mfa,
  nav,
  pages,
  footer,
  clock,
  shell,
  watch,
  journal,
  portfolio,
  alerts,
  lab,
  calendar,
  info,
  watchlist,
  trader,
  quickLook,
  study,
  regime,
  markets,
  screener,
  status,
  settings,
  ask,
  errors,
} as const;

export { ar } from './strings/shell';

export type PageKey = keyof typeof t.pages;
