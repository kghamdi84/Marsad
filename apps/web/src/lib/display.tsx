import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { DEFAULT_LOCAL_ZONE } from '@marsad/core';
import { ar, t } from '../strings';

/**
 * Display preferences (Marsad v2): theme, language and the secondary time zone. They belong to the device, like
 * a reading lamp, so they live in this browser's storage and never in the database; the page renders correctly
 * when storage is blocked. The theme and language are applied to <html> (data-theme, lang, dir) before the first
 * paint by `applyStoredDisplay` in main.tsx.
 */
export type Theme = 'dark' | 'light';
export type Lang = 'en' | 'ar';

export interface Display {
  theme: Theme;
  lang: Lang;
  /** IANA zone shown next to ET; Asia/Riyadh by default. */
  zone: string;
}

const KEY = 'marsad.display';
export const ZONES = ['Asia/Riyadh', 'Europe/London', 'UTC'] as const;

function read(): Display {
  const fallback: Display = { theme: 'dark', lang: 'en', zone: DEFAULT_LOCAL_ZONE };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return fallback;
    const v = JSON.parse(raw) as Partial<Display>;
    return {
      theme: v.theme === 'light' ? 'light' : 'dark',
      lang: v.lang === 'ar' ? 'ar' : 'en',
      zone:
        typeof v.zone === 'string' && (ZONES as readonly string[]).includes(v.zone)
          ? v.zone
          : fallback.zone,
    };
  } catch {
    return fallback;
  }
}

function apply(d: Display) {
  const html = document.documentElement;
  html.dataset['theme'] = d.theme;
  html.lang = d.lang;
  html.dir = d.lang === 'ar' ? 'rtl' : 'ltr';
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', d.theme === 'light' ? '#ffffff' : '#001a57');
}

/** Called once before React renders, so the first paint already has the right theme and direction. */
export function applyStoredDisplay(): void {
  apply(read());
}

interface Ctx extends Display {
  set: (patch: Partial<Display>) => void;
}

const DisplayContext = createContext<Ctx | null>(null);

export function DisplayProvider({ children }: { children: ReactNode }) {
  const [d, setD] = useState<Display>(read);
  useEffect(() => apply(d), [d]);
  const set = useCallback((patch: Partial<Display>) => {
    setD((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Storage blocked (private window): the choice lasts for this visit only.
      }
      return next;
    });
  }, []);
  const value = useMemo(() => ({ ...d, set }), [d, set]);
  return <DisplayContext.Provider value={value}>{children}</DisplayContext.Provider>;
}

/** The display preferences; outside the provider (tests of single components) the defaults. */
export function useDisplay(): Ctx {
  return (
    useContext(DisplayContext) ?? {
      theme: 'dark',
      lang: 'en',
      zone: DEFAULT_LOCAL_ZONE,
      set: () => undefined,
    }
  );
}

/** Navigation, page titles and notices in the chosen language. */
export function useShellText() {
  const { lang } = useDisplay();
  return lang === 'ar' ? ar : { nav: t.nav, pages: t.pages, footer: t.footer };
}
