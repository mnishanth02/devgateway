import { QueryClient } from '@tanstack/react-query';

export function createAdminQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: 5 * 60 * 1000,
        refetchOnReconnect: true,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 30 * 1000,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
