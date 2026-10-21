export type CapturedAuthRedirect = {
  route: 'invite' | 'reset' | null;
  invitation: string | null;
  code: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  type: string | null;
  error: string | null;
  invalid: boolean;
};

export function captureAuthRedirect(pathname: string, search: string, hash: string, history: History): CapturedAuthRedirect {
  const route = pathname === '/invite' ? 'invite' : pathname === '/reset-password' ? 'reset' : null;
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const invitations = query.getAll('invitation');
  const codes = [...query.getAll('code'), ...fragment.getAll('code')];
  const queryTypes = query.getAll('type');
  const accessTokens = fragment.getAll('access_token');
  const refreshTokens = fragment.getAll('refresh_token');
  const extraSecrets = [
    ...query.getAll('token_hash'), ...query.getAll('token'),
    ...fragment.getAll('token_hash'), ...fragment.getAll('token'), ...fragment.getAll('provider_token'),
    ...fragment.getAll('provider_refresh_token'), ...fragment.getAll('id_token'),
  ];
  const types = [...queryTypes, ...fragment.getAll('type')];
  const errors = [
    ...query.getAll('error'), ...query.getAll('error_code'), ...query.getAll('error_description'),
    ...fragment.getAll('error'), ...fragment.getAll('error_code'), ...fragment.getAll('error_description'),
  ];
  const accessToken = accessTokens.length === 1 && (accessTokens[0]?.length ?? 0) <= 8192 ? accessTokens[0] : null;
  const refreshToken = refreshTokens.length === 1 && (refreshTokens[0]?.length ?? 0) <= 8192 ? refreshTokens[0] : null;
  const hasPartialSession = Boolean(accessToken) !== Boolean(refreshToken);
  const hasAuthInput = invitations.length > 0 || codes.length > 0 || queryTypes.length > 0 || accessTokens.length > 0 || refreshTokens.length > 0 || extraSecrets.length > 0 || types.length > 0 || errors.length > 0;
  if (!route && !hasAuthInput) return { route, invitation: null, code: null, accessToken: null, refreshToken: null, type: null, error: null, invalid: false };

  // Auth redirect values are captured only in memory. Scrub every auth callback path
  // before importing React, the router, or any feature module.
  history.replaceState(history.state, '', pathname);
  const invitation = invitations.length === 1 && /^[a-f0-9]{64}$/.test(invitations[0] ?? '') ? invitations[0] : null;
  const code = codes.length === 1 && (codes[0]?.length ?? 0) > 0 && (codes[0]?.length ?? 0) <= 8192 ? codes[0] : null;
  return {
    route,
    invitation,
    code,
    accessToken,
    refreshToken,
    type: types.length === 1 ? types[0] : null,
    error: errors.length > 0 ? 'auth_link_error' : null,
    invalid: invitations.length > 1 || (invitations.length === 1 && !invitation) || codes.length > 1 || (codes.length === 1 && !code)
      || accessTokens.length > 1 || refreshTokens.length > 1 || (accessTokens.length === 1 && !accessToken) || (refreshTokens.length === 1 && !refreshToken)
      || types.length > 1 || Boolean(codes.length && (accessTokens.length || refreshTokens.length))
      || hasPartialSession || Boolean(codes.length && extraSecrets.length),
  };
}
