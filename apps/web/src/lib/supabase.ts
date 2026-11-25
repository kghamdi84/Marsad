import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/** The address the app opened at, read before the client can rewrite it (a failed sign-in link puts its reason here). */
export const landingUrl = typeof window === 'undefined' ? '' : window.location.href;

/** Null when the build has no Supabase configuration; the UI says so instead of failing. */
export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          // The default Supabase email (no custom SMTP yet) carries a sign-in link, not a code.
          // Implicit flow: the link completes in whichever browser opens it (an iPhone mail app often
          // opens Safari or its own viewer, not the browser that asked). ADR 0005, revision 2026-11-25.
          flowType: 'implicit',
          detectSessionInUrl: true,
        },
      })
    : null;
