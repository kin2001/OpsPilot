import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import type { Database } from '../../lib/database.types';
import type { CapturedAuthRedirect } from './capture-url';
import { clearAuthenticatedData } from '../query-client';

type Assurance = 'aal1' | 'aal2' | null;
type AuthContextValue = {
  client: SupabaseClient<Database>;
  session: Session | null;
  user: User | null;
  loading: boolean;
  callbackError: 'invalid' | 'expired' | null;
  assurance: Assurance;
  verifiedTotpFactors: { id: string; friendly_name: string | null; created_at: string }[];
  refreshAssurance: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider is required');
  return value;
}

export function AuthProvider({ client, authRedirect, children }: {
  client: SupabaseClient<Database>; authRedirect: CapturedAuthRedirect; children: ReactNode;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [callbackError, setCallbackError] = useState<AuthContextValue['callbackError']>(null);
  const [assurance, setAssurance] = useState<Assurance>(null);
  const [verifiedTotpFactors, setVerifiedTotpFactors] = useState<AuthContextValue['verifiedTotpFactors']>([]);
  const userId = useRef<string | null>(null);

  const refreshAssurance = async () => {
    const requestedUserId = userId.current;
    const [{ data: level, error: levelError }, { data: factors, error: factorsError }] = await Promise.all([
      client.auth.mfa.getAuthenticatorAssuranceLevel(),
      client.auth.mfa.listFactors(),
    ]);
    if (userId.current !== requestedUserId) return;
    if (levelError || factorsError) {
      setAssurance(null);
      setVerifiedTotpFactors([]);
      return;
    }
    setAssurance(level.currentLevel === 'aal2' ? 'aal2' : level.currentLevel === 'aal1' ? 'aal1' : null);
    setVerifiedTotpFactors(factors.totp.filter((factor) => factor.status === 'verified').map((factor) => ({
      id: factor.id,
      friendly_name: factor.friendly_name ?? null,
      created_at: factor.created_at,
    })));
  };

  useEffect(() => {
    let active = true;
    const applySession = (next: Session | null) => {
      const nextUserId = next?.user.id ?? null;
      if (userId.current !== nextUserId) {
        userId.current = nextUserId;
        setAssurance(null);
        setVerifiedTotpFactors([]);
        void clearAuthenticatedData(client);
      }
      setSession(next);
    };
    const { data: authListener } = client.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      applySession(next);
    });

    const initialize = async () => {
      if (authRedirect.invalid) {
        setCallbackError('invalid');
      } else if (authRedirect.error) {
        setCallbackError('expired');
      } else if (authRedirect.route === 'reset' && authRedirect.type && authRedirect.type !== 'recovery') {
        setCallbackError('invalid');
      } else if (authRedirect.accessToken && authRedirect.refreshToken) {
        const { data, error } = await client.auth.setSession({ access_token: authRedirect.accessToken, refresh_token: authRedirect.refreshToken });
        if (!active) return;
        if (error || !data.session) setCallbackError('expired');
        else applySession(data.session);
      } else if (authRedirect.code) {
        const { data, error } = await client.auth.exchangeCodeForSession(authRedirect.code);
        if (!active) return;
        if (error || !data.session) setCallbackError('expired');
        else applySession(data.session);
      } else {
        const { data, error } = await client.auth.getSession();
        if (!active) return;
        if (error) setCallbackError('expired');
        applySession(data.session);
      }
      if (active) setLoading(false);
    };
    void initialize();
    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, [client, authRedirect]);

  useEffect(() => {
    if (session) void refreshAssurance();
    else {
      setAssurance(null);
      setVerifiedTotpFactors([]);
    }
  }, [session?.user.id]);

  const value = useMemo<AuthContextValue>(() => ({
    client,
    session,
    user: session?.user ?? null,
    loading,
    callbackError,
    assurance,
    verifiedTotpFactors,
    refreshAssurance,
    signOut: async () => {
      await clearAuthenticatedData(client);
      const { error } = await client.auth.signOut();
      if (error) throw new Error('DEPENDENCY_UNAVAILABLE');
      setSession(null);
    },
  }), [client, session, loading, callbackError, assurance, verifiedTotpFactors]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
