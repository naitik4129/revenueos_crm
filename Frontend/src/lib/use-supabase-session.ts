import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase-client";

export interface SupabaseSessionState {
  /** true only while Supabase is configured AND we're still checking for an existing session. */
  loading: boolean;
  session: Session | null;
}

/**
 * Tracks the current Supabase Auth session for the AuthGate + login page.
 * When Supabase isn't configured (see supabase-client.ts), resolves
 * immediately with session: null and loading: false so the app never hangs
 * waiting on auth that isn't set up.
 */
export function useSupabaseSession(): SupabaseSessionState {
  const [state, setState] = useState<SupabaseSessionState>({
    loading: Boolean(supabase),
    session: null,
  });

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(({ data }) => {
      setState({ loading: false, session: data.session });
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ loading: false, session });
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  return state;
}
