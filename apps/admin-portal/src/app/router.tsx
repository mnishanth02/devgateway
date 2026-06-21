import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  type RouterHistory,
} from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { AuthenticatedAdminLayout } from './routes/authenticated-admin-layout.js';
import { OperationsHome } from './routes/operations-home.js';

export interface AdminRouterContext {
  readonly queryClient: QueryClient;
}

export interface CreateAdminRouterOptions extends AdminRouterContext {
  readonly history?: RouterHistory;
}

const rootRoute = createRootRouteWithContext<AdminRouterContext>()({
  component: AuthenticatedAdminLayout,
  notFoundComponent: () => (
    <main className="auth-state">
      <p className="eyebrow">Route not found</p>
      <h1>Unknown admin surface.</h1>
      <p>The Phase 1.6 shell only exposes the Track 1 command board.</p>
    </main>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: OperationsHome,
});

export const routeTree = rootRoute.addChildren([indexRoute]);

export function createAdminRouter(options: CreateAdminRouterOptions) {
  const routerOptions = {
    routeTree,
    context: {
      queryClient: options.queryClient,
    },
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 30_000,
  } as const;

  if (options.history !== undefined) {
    return createRouter({
      ...routerOptions,
      history: options.history,
    });
  }

  return createRouter(routerOptions);
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAdminRouter>;
  }
}
