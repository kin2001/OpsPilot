import { describe, expect, it, vi } from 'vitest';
import { captureAuthRedirect } from './capture-url';

function historySpy() {
  return { state: { marker: true }, replaceState: vi.fn() } as unknown as History;
}

describe('authentication redirect capture', () => {
  it('captures confirmation credentials on the root route and scrubs before render', () => {
    const history = historySpy();
    const captured = captureAuthRedirect('/', '', '#access_token=synthetic-access&refresh_token=synthetic-refresh&type=signup', history);
    expect(captured).toMatchObject({ route: null, accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', type: 'signup' });
    expect(history.replaceState).toHaveBeenCalledWith({ marker: true }, '', '/');
  });

  it('captures the PKCE recovery code and its type from the reset route query', () => {
    const history = historySpy();
    const captured = captureAuthRedirect('/reset-password', '?code=synthetic-code&type=recovery', '', history);
    expect(captured).toMatchObject({ route: 'reset', code: 'synthetic-code', type: 'recovery', invalid: false });
    expect(history.replaceState).toHaveBeenCalledWith({ marker: true }, '', '/reset-password');
  });

  it('scrubs provider-only secrets and Auth error descriptions even when it cannot use them', () => {
    const history = historySpy();
    const captured = captureAuthRedirect('/', '?error_description=synthetic-error', '#provider_token=synthetic-provider-token', history);
    expect(captured).toMatchObject({ route: null, error: 'auth_link_error', invalid: false });
    expect(JSON.stringify(captured)).not.toContain('synthetic-provider-token');
    expect(JSON.stringify(captured)).not.toContain('synthetic-error');
    expect(history.replaceState).toHaveBeenCalledWith({ marker: true }, '', '/');
  });

  it('rejects repeated sensitive parameters and partial sessions', () => {
    const duplicates = captureAuthRedirect('/invite', '?invitation=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&invitation=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '', historySpy());
    const partial = captureAuthRedirect('/invite', '?invitation=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '#access_token=synthetic-access', historySpy());
    expect(duplicates.invalid).toBe(true);
    expect(partial.invalid).toBe(true);
  });
});
