/**
 * Navigation, page titles, the shell chrome and the Arabic shell labels.
 * Import `t` from `strings.ts`, not this module (ADR 0051).
 */

export const nav = {
  watch: 'Watch',
  study: 'Study',
  regime: 'Regime',
  alerts: 'Alerts',
  journal: 'Journal',
  status: 'Status',
  lab: 'Lab',
  settings: 'Settings',
  signOut: 'Sign out',
  primary: 'Main sections',
} as const;

/** Page titles and subtitles (Marsad v2); translated in `ar` below. */
export const pages = {
  watch: {
    title: 'Watch',
    subtitle:
      'Morning brief, watchlist with company names, latest news, calendar and sectors. Prices are end of day.',
  },
  study: {
    title: 'Study',
    subtitle:
      'Search a company: chart, snapshot, news, filings, financials, holders and the thesis.',
  },
  regime: {
    title: 'Market regime',
    subtitle:
      'The regime label and why, what the S&P did next, the recession filter, Fear and Greed, capitulation watch and sector rotation.',
  },
  alerts: {
    title: 'Alerts',
    subtitle:
      'Every alert carries its trigger, plan, risk history, checklist, bear case and sources. No buy or sell advice.',
  },
  journal: {
    title: 'Journal',
    subtitle:
      'Positions by horizon, the position sizer and the manual Sahm ticket, options, exposure and trades.',
  },
  lab: {
    title: 'Lab',
    subtitle: 'Eleven playbooks. Each earns live status only through out-of-sample tests.',
  },
  status: { title: 'Status', subtitle: 'Every row of source_status, job runs and costs.' },
  settings: {
    title: 'Settings',
    subtitle: 'Language, theme, notifications, Shariah limits, AI caps and security.',
  },
} as const;

export const footer =
  'Alert-only observatory. Never places orders and never gives personal buy or sell recommendations.' as const;

export const clock = { et: 'ET', local: 'local' } as const;

export const shell = {
  logoArabic: '\u0645\u0631\u0635\u062F',
  logoArabicFull: 'مرصد السوق',
  more: 'More',
  close: 'Close',
  market: {
    regular: 'Open',
    earlyClose: 'Open, early close',
    preMarket: 'Pre-market',
    afterHours: 'After hours',
    closed: 'Closed',
    holiday: (name: string) => `Closed, ${name}`,
    uncovered: 'Calendar not loaded',
    unknown: 'Market state unavailable',
  },
  fresh: 'All fresh',
  stale: (n: number) => `${n} stale`,
  unchecked: (n: number) => `${n} unchecked`,
  noSources: 'No source status yet',
  healthUnknown: 'Health unavailable',
  chipExtra: (health: string) => `. ${health}. Show times and source health`,
  chipAria: (market: string, health: string) =>
    `${market}. ${health}. Show times and source health`,
  marketTitle: 'Market and data',
  attention: (n: number) =>
    n === 0
      ? 'Every source is fresh'
      : `${n} ${n === 1 ? 'source needs' : 'sources need'} attention`,
  badgeStale: 'Stale',
  badgeUnchecked: 'Not judged',
  newYork: 'New York (ET)',
  local: 'Riyadh',
  nextOpen: (when: string) => `Next regular open: ${when}.`,
  uncoveredNote:
    'The holiday calendar is not loaded, so the session and session-dependent freshness cannot be judged.',
  staleTitle: 'Past its silence limit',
  uncheckedTitle: 'Calendar not loaded, cannot judge',
  allFresh: 'Every reporting source is within its silence limit for this session.',
  openStatus: 'Open Status for every source',
  pull: {
    idle: 'Pull to refresh',
    release: 'Release to refresh',
    refreshing: 'Refreshing',
    updated: (time: string) => `Updated ${time} ET`,
  },
} as const;

type Texts<T> = { [K in keyof T]: T[K] extends string ? string : Texts<T[K]> };

/**
 * Arabic (Marsad v2): navigation, page titles and subtitles and the notices. Everything else stays in English
 * for now; numbers, tickers, dates and times keep their left-to-right order inside Arabic text.
 */
export const ar: {
  nav: Texts<typeof nav>;
  pages: Texts<typeof pages>;
  footer: string;
} = {
  nav: {
    watch: 'المراقبة',
    study: 'الدراسة',
    regime: 'النظام السوقي',
    alerts: 'التنبيهات',
    journal: 'السجل',
    lab: 'المختبر',
    status: 'الحالة',
    settings: 'الإعدادات',
    signOut: 'تسجيل الخروج',
    primary: 'الأقسام الرئيسية',
  },
  pages: {
    watch: {
      title: 'المراقبة',
      subtitle:
        'ملخص الصباح وقائمة المراقبة وآخر الأخبار والتقويم والقطاعات. الأسعار بنهاية اليوم.',
    },
    study: {
      title: 'الدراسة',
      subtitle:
        'ابحث عن شركة: الرسم البياني والملخص والأخبار والإفصاحات والقوائم المالية والملاك والأطروحة.',
    },
    regime: {
      title: 'النظام السوقي',
      subtitle:
        'تسمية السوق وسببها، ودراسة الأحداث، وفلتر الركود، والخوف والطمع، ومراقبة الاستسلام.',
    },
    alerts: {
      title: 'التنبيهات',
      subtitle: 'كل تنبيه مع المحفز والخطة وسجل المخاطر وقائمة التحقق وحالة الهبوط والمصادر.',
    },
    journal: {
      title: 'السجل',
      subtitle: 'المراكز وحاسبة الحجم وتذكرة سهم اليدوية والخيارات والتعرض.',
    },
    lab: {
      title: 'المختبر',
      subtitle: 'إحدى عشرة استراتيجية لا تصبح حية إلا بعد اختبار خارج العينة.',
    },
    status: { title: 'الحالة', subtitle: 'حالة مصادر البيانات والمهام والتكاليف.' },
    settings: {
      title: 'الإعدادات',
      subtitle: 'اللغة والمظهر والتنبيهات والحدود الشرعية وحدود الذكاء الاصطناعي والأمان.',
    },
  },
  footer: 'مرصد للتنبيهات فقط. لا ينفذ أوامر ولا يقدم توصيات شراء أو بيع شخصية.',
};
