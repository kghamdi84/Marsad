import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/** Null when the build has no Supabase configuration; the UI says so instead of failing. */
export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      })
    : null;
