import { QueryClient } from '@tanstack/react-query';
import { domainError } from '../lib/domain-errors';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../lib/database.types';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 60_000,
      retry: (failureCount, error) => {
        const code = domainError(error).code;
        return failureCount < 2 && (code === 'DEPENDENCY_UNAVAILABLE' || code === 'RATE_LIMITED');
      },
      retryDelay: (attempt) => Math.min(300 * 2 ** attempt + Math.random() * 250, 2_000),
      refetchOnWindowFocus: false,
    },
    mutations: { retry: false },
  },
});

export async function clearAuthenticatedData(client: SupabaseClient<Database>, options: { preserveMembershipsFor?: string } = {}) {
  const shouldKeepMemberships = (query: { queryKey: readonly unknown[] }) =>
    options.preserveMembershipsFor !== undefined
    && query.queryKey[0] === 'memberships'
    && query.queryKey[1] === options.preserveMembershipsFor;
  const clearOtherQueries = (query: { queryKey: readonly unknown[] }) => !shouldKeepMemberships(query);
  await queryClient.cancelQueries({ predicate: clearOtherQueries });
  queryClient.removeQueries({ predicate: clearOtherQueries });
  await client.removeAllChannels();
}
