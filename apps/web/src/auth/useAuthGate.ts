import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { gateFor, type Aal, type Gate } from './gate';

interface State {
  loading: boolean;
  hasSession: boolean;
  email: string | null;
  currentLevel: Aal;
  nextLevel: Aal;
}

export function useAuthGate(): { gate: Gate; email: string | null; refresh: () => void } {
  const [s, setS] = useState<State>({
    loading: true,
    hasSession: false,
    email: null,
    currentLevel: null,
    nextLevel: null,
  });

  const refresh = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    // Remove what a sign-in link leaves in the address bar: tokens or an error in the fragment,
    // or a one-time ?code= (older links), so nothing sensitive stays in history.
    const url = new URL(window.location.href);
    const leftover =
      /(?:^|&)(?:access_token|refresh_token|error|error_code|error_description)=/.test(
        url.hash.slice(1),
      ) || url.searchParams.has('code');
    if (leftover) {
      url.searchParams.delete('code');
      for (const k of ['error', 'error_code', 'error_description']) url.searchParams.delete(k);
      window.history.replaceState(null, '', url.pathname + url.search);
    }
    if (!session) {
      setS({ loading: false, hasSession: false, email: null, currentLevel: null, nextLevel: null });
      return;
    }
    const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    setS({
      loading: false,
      hasSession: true,
      email: session.user.email ?? null,
      currentLevel: (aal.data?.currentLevel as Aal) ?? null,
      nextLevel: (aal.data?.nextLevel as Aal) ?? null,
    });
  }, []);

  useEffect(() => {
    if (!supabase) return;
    // The listener fires INITIAL_SESSION on subscribe, so it also covers the first load.
    const { data } = supabase.auth.onAuthStateChange(() => {
      // Supabase advises against awaiting other auth calls inside this callback.
      setTimeout(() => void refresh(), 0);
    });
    return () => data.subscription.unsubscribe();
  }, [refresh]);

  return {
    gate: gateFor({ configured: supabase !== null, ...s }),
    email: s.email,
    refresh: () => void refresh(),
  };
}
