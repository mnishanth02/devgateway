import { queryOptions } from '@tanstack/react-query';
import { fetchBetterAuthSession } from './auth-session.js';

export const adminSessionQueryKey = ['better-auth', 'admin-session'] as const;

export function adminSessionQueryOptions() {
  return queryOptions({
    queryKey: adminSessionQueryKey,
    queryFn: ({ signal }) => fetchBetterAuthSession({ signal }),
    retry: false,
    staleTime: 15 * 1000,
  });
}
