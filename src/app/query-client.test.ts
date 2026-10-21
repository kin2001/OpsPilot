import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearAuthenticatedData, queryClient } from './query-client';

const userId = 'f62f89a7-6571-498c-9f92-9019e279dfd5';
const organizationId = '812de877-0151-497a-a13d-2749b0a3d622';

afterEach(() => queryClient.clear());

describe('authenticated data cleanup', () => {
  it('clears tenant data while retaining the fresh membership authorization result', async () => {
    const removeAllChannels = vi.fn().mockResolvedValue('ok');
    const client = { removeAllChannels } as never;
    queryClient.setQueryData(['memberships', userId], []);
    queryClient.setQueryData(['assets', userId, organizationId], [{ id: 'asset' }]);
    queryClient.setQueryData(['requests', userId, organizationId], [{ id: 'request' }]);

    await clearAuthenticatedData(client, { preserveMembershipsFor: userId });

    expect(queryClient.getQueryData(['memberships', userId])).toEqual([]);
    expect(queryClient.getQueryData(['assets', userId, organizationId])).toBeUndefined();
    expect(queryClient.getQueryData(['requests', userId, organizationId])).toBeUndefined();
    expect(removeAllChannels).toHaveBeenCalledOnce();
  });

  it('clears membership data when no fresh authorization result is retained', async () => {
    const client = { removeAllChannels: vi.fn().mockResolvedValue('ok') } as never;
    queryClient.setQueryData(['memberships', userId], []);

    await clearAuthenticatedData(client);

    expect(queryClient.getQueryData(['memberships', userId])).toBeUndefined();
  });
});
